use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind},
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
pub mod tracing_layer;
pub use app::{App, AppEvent, Chain, Transaction, TxStatus};
pub use tracing_layer::TuiLayer;

/// Run the TUI. This function blocks — call it from a dedicated thread.
pub fn run_tui(mut event_rx: Receiver<AppEvent>) -> eyre::Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = App::new();
    let mut last_tick = std::time::Instant::now();
    let tick_rate = Duration::from_millis(250);

    loop {
        terminal.draw(|f| ui(f, &mut app))?;

        let timeout = tick_rate
            .checked_sub(last_tick.elapsed())
            .unwrap_or_default();

        if crossterm::event::poll(timeout)? {
            if let Event::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Press {
                    match key.code {
                        KeyCode::Char('q') | KeyCode::Char('Q') => break,
                        KeyCode::Up => app.scroll_up(),
                        KeyCode::Down => app.scroll_down(),
                        _ => {}
                    }
                }
            }
        }

        while let Ok(evt) = event_rx.try_recv() {
            match evt {
                AppEvent::Balance(chain, amount) => app.update_balance(chain, amount),
                AppEvent::Address(chain, addr) => app.update_address(chain, addr),
                AppEvent::Mode(chain, mode, url) => app.set_mode(chain, mode, url),
                AppEvent::Tx(tx) => app.add_transaction(tx),
                AppEvent::TxUpdate(id, status) => app.update_transaction_status(id, status),
                AppEvent::Log(msg) => app.add_log(msg),
                AppEvent::Shutdown => {
                    app.should_quit = true;
                }
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
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    Ok(())
}

fn ui(f: &mut Frame, app: &mut App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(5),  // balance bar
            Constraint::Length(10), // orders table
            Constraint::Min(0),     // logs
        ])
        .split(f.area());

    render_balance_bar(f, app, chunks[0]);
    render_transactions(f, app, chunks[1]);
    render_logs(f, app, chunks[2]);
}

fn render_balance_bar(f: &mut Frame, app: &App, area: Rect) {
    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(34),
            Constraint::Percentage(33),
            Constraint::Percentage(33),
        ])
        .split(area);

    let evm_text = format!("{}\n{}\n{}", app.eth_balance, app.evm_address, app.evm_conn_url);
    let sol_text = format!("{}\n{}\n{}", app.sol_balance, app.solana_address, app.sol_conn_url);
    let sui_text = format!("{}\n{}\n{}", app.sui_balance, app.sui_address, app.sui_conn_url);

    let evm_title = format!(" EVM (Base) · {} ", app.evm_mode);
    let sol_title = format!(" SOL (Devnet) · {} ", app.sol_mode);
    let sui_title = format!(" SUI (Testnet) · {} ", app.sui_mode);

    f.render_widget(
        Paragraph::new(evm_text)
            .block(Block::default().borders(Borders::ALL).title(evm_title))
            .style(Style::default().fg(Color::Blue)),
        columns[0],
    );
    f.render_widget(
        Paragraph::new(sol_text)
            .block(Block::default().borders(Borders::ALL).title(sol_title))
            .style(Style::default().fg(Color::Magenta)),
        columns[1],
    );
    f.render_widget(
        Paragraph::new(sui_text)
            .block(Block::default().borders(Borders::ALL).title(sui_title))
            .style(Style::default().fg(Color::Cyan)),
        columns[2],
    );
}

fn render_transactions(f: &mut Frame, app: &mut App, area: Rect) {
    let rows: Vec<_> = app
        .transactions
        .iter()
        .map(|tx| {
            let (status_sym, status_color) = match tx.status {
                TxStatus::Success => ("✓", Color::Green),
                TxStatus::Failed => ("✗", Color::Red),
                TxStatus::Pending => ("▶", Color::Yellow),
            };
            Row::new(vec![
                Cell::from(tx.timestamp.clone()),
                Cell::from(tx.action.clone()),
                Cell::from(tx.intent_id.clone()),
                Cell::from(tx.amount.clone()),
                Cell::from(status_sym).style(Style::default().fg(status_color)),
            ])
        })
        .collect();

    let widths = [
        Constraint::Length(10),
        Constraint::Length(14),
        Constraint::Length(10),
        Constraint::Length(12),
        Constraint::Length(8),
    ];

    let table = Table::new(rows, widths)
        .header(
            Row::new(vec!["Time", "Route", "Intent", "Amount", "Status"])
                .style(Style::default().add_modifier(Modifier::BOLD)),
        )
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(" Orders | q:quit "),
        );

    f.render_stateful_widget(table, area, &mut app.table_state);
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
        " Logs ({} | {} | uptime:{}s) | ↑↓:scroll  q:quit ",
        app.logs.len(),
        scroll_label,
        app.uptime_secs()
    );

    // Visible lines inside the border
    let visible = area.height.saturating_sub(2) as usize;
    let total = app.logs.len();

    // log_scroll = lines scrolled UP from bottom (0 = show newest at bottom)
    let start = total
        .saturating_sub(visible)
        .saturating_sub(app.log_scroll);

    let lines: Vec<Line> = app
        .logs
        .iter()
        .skip(start)
        .take(visible)
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
        .block(Block::default().borders(Borders::ALL).title(title));

    f.render_widget(paragraph, area);
}
