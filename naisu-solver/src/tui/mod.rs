use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Cell, Paragraph, Row, Table},
    Frame, Terminal,
};
use std::io;
use std::time::Duration;
use tokio::sync::mpsc::Receiver;

pub mod app;
pub use app::{App, AppEvent, Chain, Transaction, TxStatus, View};

pub async fn run_tui(mut event_rx: Receiver<AppEvent>) -> eyre::Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = App::new();
    let mut last_tick = std::time::Instant::now();
    let tick_rate = Duration::from_millis(250);

    loop {
        terminal.draw(|f| ui(f, &mut app))?;

        let timeout = tick_rate
            .checked_sub(last_tick.elapsed())
            .unwrap_or_else(|| Duration::from_secs(0));

        if crossterm::event::poll(timeout)? {
            match event::read()? {
                Event::Key(key) => {
                    if key.kind == KeyEventKind::Press {
                        match key.code {
                            KeyCode::Char('q') | KeyCode::Char('Q') => break,
                            KeyCode::Up => app.scroll_up(),
                            KeyCode::Down => app.scroll_down(),
                            KeyCode::Char('t') | KeyCode::Char('T') => app.toggle_view(),
                            _ => {}
                        }
                    }
                }
                Event::Resize(_, _) => {}
                _ => {}
            }
        }

        while let Ok(evt) = event_rx.try_recv() {
            match evt {
                AppEvent::Balance(chain, amount) => app.update_balance(chain, amount),
                AppEvent::Address(chain, addr) => app.update_address(chain, addr),
                AppEvent::Tx(tx) => app.add_transaction(tx),
                AppEvent::Log(msg) => app.add_log(msg),
                AppEvent::Shutdown => break,
            }
        }

        if last_tick.elapsed() >= tick_rate {
            app.on_tick();
            last_tick = std::time::Instant::now();
        }

        if app.should_quit {
            break;
        }
    }

    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    Ok(())
}

fn ui(f: &mut Frame, app: &mut App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(5), Constraint::Min(0)].as_ref())
        .split(f.area());

    render_balance_bar(f, app, chunks[0]);

    match app.active_view {
        View::Logs => render_logs(f, app, chunks[1]),
        View::Transactions => render_transactions(f, app, chunks[1]),
    }
}

fn render_balance_bar(f: &mut Frame, app: &App, area: Rect) {
    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(33),
            Constraint::Percentage(34),
            Constraint::Percentage(33),
        ])
        .split(area);

    let sui_text = format!("{}\n{}", app.sui_balance, app.sui_address);
    let evm_text = format!("{}\n{}", app.eth_balance, app.evm_address);
    let sol_text = format!("{}\n{}", app.sol_balance, app.solana_address);

    f.render_widget(
        Paragraph::new(sui_text)
            .block(Block::default().borders(Borders::ALL).title(" SUI "))
            .style(Style::default().fg(Color::Cyan)),
        columns[0],
    );
    f.render_widget(
        Paragraph::new(evm_text)
            .block(Block::default().borders(Borders::ALL).title(" EVM "))
            .style(Style::default().fg(Color::Blue)),
        columns[1],
    );
    f.render_widget(
        Paragraph::new(sol_text)
            .block(Block::default().borders(Borders::ALL).title(" SOL "))
            .style(Style::default().fg(Color::Magenta)),
        columns[2],
    );
}

fn log_color(msg: &str) -> Color {
    if msg.contains("FULFILLED") || msg.contains("✓") {
        Color::Green
    } else if msg.contains("NEW ORDER") || msg.contains("▶") {
        Color::Yellow
    } else if msg.contains("STEP") {
        Color::Cyan
    } else if msg.to_lowercase().contains("error") || msg.to_lowercase().contains("failed") {
        Color::Red
    } else {
        Color::Gray
    }
}

fn render_logs(f: &mut Frame, app: &App, area: Rect) {
    let scroll_label = if app.auto_scroll { "auto-scroll" } else { "manual" };
    let title = format!(
        " Logs ({} | {} | uptime:{}s) | T:txs  ↑↓:scroll  q:quit ",
        app.logs.len(),
        scroll_label,
        app.uptime_secs()
    );

    let lines: Vec<Line> = app
        .logs
        .iter()
        .map(|(ts, msg)| {
            let time_str = ts.format("%H:%M:%S").to_string();
            let color = log_color(msg);
            Line::from(vec![
                Span::styled(
                    format!("[{}] ", time_str),
                    Style::default().fg(Color::DarkGray),
                ),
                Span::styled(msg.clone(), Style::default().fg(color)),
            ])
        })
        .collect();

    let paragraph = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).title(title))
        .scroll((app.log_scroll as u16, 0));

    f.render_widget(paragraph, area);
}

fn render_transactions(f: &mut Frame, app: &mut App, area: Rect) {
    let rows: Vec<_> = app
        .transactions
        .iter()
        .map(|tx| {
            let status_color = match tx.status {
                TxStatus::Success => Color::Green,
                TxStatus::Failed => Color::Red,
                TxStatus::Pending => Color::Yellow,
            };
            Row::new(vec![
                Cell::from(tx.timestamp.clone()),
                Cell::from(format!("{:?}", tx.chain)),
                Cell::from(tx.action.clone()),
                Cell::from(tx.intent_id.clone()),
                Cell::from(tx.sender.clone()),
                Cell::from(tx.recipient.clone()),
                Cell::from(tx.amount.clone()),
                Cell::from(format!("{:?}", tx.status))
                    .style(Style::default().fg(status_color)),
            ])
        })
        .collect();

    let widths = &[
        Constraint::Length(10),
        Constraint::Length(8),
        Constraint::Length(10),
        Constraint::Length(12),
        Constraint::Length(14),
        Constraint::Length(14),
        Constraint::Length(12),
        Constraint::Length(8),
    ];

    let table = Table::new(rows, widths)
        .header(
            Row::new(vec![
                "Time", "Chain", "Action", "Intent", "From", "To", "Amount", "Status",
            ])
            .style(Style::default().add_modifier(Modifier::BOLD)),
        )
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(" Transactions | T:logs  q:quit "),
        );

    f.render_stateful_widget(table, area, &mut app.table_state);
}
