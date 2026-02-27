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
    widgets::{
        Block, Borders, Cell, Paragraph, Row, Table, Tabs,
    },
    Frame, Terminal,
};
use std::io;
use std::time::Duration;

use tokio::sync::mpsc::Receiver;

pub mod app;

pub use app::{App, AppEvent, Transaction, Chain, TxStatus, Tab};

pub async fn run_tui(mut event_rx: Receiver<AppEvent>) -> eyre::Result<()> {
    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = App::new();

    let mut last_tick = std::time::Instant::now();
    let tick_rate = Duration::from_millis(250);

    // Main loop
    loop {
        // Draw UI
        terminal.draw(|f| ui(f, &mut app))?;

        // Handle events with timeout
        let timeout = tick_rate
            .checked_sub(last_tick.elapsed())
            .unwrap_or_else(|| Duration::from_secs(0));

        if crossterm::event::poll(timeout)? {
            match event::read()? {
                Event::Key(key) => {
                    if key.kind == KeyEventKind::Press {
                        match key.code {
                            KeyCode::Char('q') => break,
                            KeyCode::Char('Q') => break,
                            KeyCode::Tab => app.next_tab(),
                            KeyCode::Right => app.next_tab(),
                            KeyCode::Left => app.prev_tab(),
                            KeyCode::Char('1') => app.set_tab(Tab::Status),
                            KeyCode::Char('2') => app.set_tab(Tab::Balances),
                            KeyCode::Char('3') => app.set_tab(Tab::Transactions),
                            KeyCode::Char('4') => app.set_tab(Tab::Logs),
                            _ => {}
                        }
                    }
                }
                Event::Resize(_, _) => {
                    // Terminal resized - next draw will adapt automatically
                }
                _ => {}
            }
        }

        // Handle solver events
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

    // Restore terminal
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
        .margin(1)
        .constraints([Constraint::Length(3), Constraint::Min(0)].as_ref())
        .split(f.area());

    // Tabs
    let titles: Vec<Line<'_>> = ["Status", "Balances", "Transactions", "Logs"]
        .iter()
        .map(|t| {
            Line::from(Span::styled(
                *t,
                Style::default().fg(Color::White),
            ))
        })
        .collect();

    let tabs = Tabs::new(titles)
        .block(Block::default().borders(Borders::ALL).title("Solver Dashboard"))
        .select(app.active_tab as usize)
        .style(Style::default().fg(Color::Cyan))
        .highlight_style(Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD));

    f.render_widget(tabs, chunks[0]);

    // Content
    match app.active_tab {
        Tab::Status => render_status(f, app, chunks[1]),
        Tab::Balances => render_balances(f, app, chunks[1]),
        Tab::Transactions => render_transactions(f, app, chunks[1]),
        Tab::Logs => render_logs(f, app, chunks[1]),
    }
}

fn render_status(f: &mut Frame, app: &mut App, area: Rect) {
    let main_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(10), Constraint::Min(8)].as_ref())
        .split(area);

    // Top row: Status + Balances side by side
    let top_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)].as_ref())
        .split(main_chunks[0]);

    // Status block (left)
    let status_text = format!(
        "🟢 Solver Active\n\nUptime: {}s\nActive Intents: {}\nTotal Transactions: {}\n\nPress 1-4 for tabs, q to quit",
        app.uptime_secs(),
        app.active_intents,
        app.transactions.len()
    );
    let status = Paragraph::new(status_text)
        .block(Block::default().borders(Borders::ALL).title("Status"));
    f.render_widget(status, top_chunks[0]);

    // Balances block (right) - 3 chains
    let balances_text = format!(
        "SUI:\n{}\n\nAVAX/ETH:\n{}\n\nSOL:\n{}",
        app.sui_balance,
        app.eth_balance,
        app.sol_balance
    );
    let balances = Paragraph::new(balances_text)
        .block(Block::default().borders(Borders::ALL).title("💰 Balances"));
    f.render_widget(balances, top_chunks[1]);

    // Recent activity (bottom)
    let recent_txs: Vec<_> = app.transactions.iter().take(5).collect();
    let rows: Vec<_> = recent_txs
        .iter()
        .map(|tx| {
            Row::new(vec![
                Cell::from(tx.timestamp.clone()),
                Cell::from(format!("{:?}", tx.chain)),
                Cell::from(tx.action.clone()),
                Cell::from(tx.intent_id.clone()),
                Cell::from(format!("{:?}", tx.status)),
            ])
        })
        .collect();

    let table = Table::new(rows, &[Constraint::Length(10), Constraint::Length(12), Constraint::Length(10), Constraint::Length(15), Constraint::Length(10)])
        .header(
            Row::new(vec!["Time", "Chain", "Action", "Intent", "Status"])
                .style(Style::default().add_modifier(Modifier::BOLD)),
        )
        .block(Block::default().borders(Borders::ALL).title("Recent Activity"));

    f.render_widget(table, main_chunks[1]);
}

fn render_balances(f: &mut Frame, app: &App, area: Rect) {
    let balances = vec![
        ("SUI", &app.sui_balance, &app.sui_address, Color::Cyan),
        ("ETH/AVAX", &app.eth_balance, &app.evm_address, Color::Blue),
        ("SOL", &app.sol_balance, &app.solana_address, Color::Magenta),
    ];

    let rows: Vec<_> = balances
        .into_iter()
        .map(|(name, balance, address, color)| {
            Row::new(vec![
                Cell::from(name).style(Style::default().fg(color)),
                Cell::from(address.as_str()),
                Cell::from(balance.as_str()),
            ])
        })
        .collect();

    let table = Table::new(rows, &[Constraint::Length(12), Constraint::Length(30), Constraint::Length(20)])
        .header(
            Row::new(vec!["Asset", "Address", "Balance"])
                .style(Style::default().add_modifier(Modifier::BOLD)),
        )
        .block(Block::default().borders(Borders::ALL).title("Balances"));

    f.render_widget(table, area);
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
                Cell::from(format!("{:?}", tx.status)).style(Style::default().fg(status_color)),
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
            Row::new(vec!["Time", "Chain", "Action", "Intent", "From", "To", "Amount", "Status"])
                .style(Style::default().add_modifier(Modifier::BOLD)),
        )
        .block(Block::default().borders(Borders::ALL).title("Transactions"));

    f.render_stateful_widget(table, area, &mut app.table_state);
}

fn render_logs(f: &mut Frame, app: &App, area: Rect) {
    let logs: Vec<_> = app
        .logs
        .iter()
        .map(|(timestamp, msg)| {
            let time_str = timestamp.format("%H:%M:%S").to_string();
            format!("[{}] {}", time_str, msg)
        })
        .collect();

    let text = if logs.is_empty() {
        "No logs yet...".to_string()
    } else {
        logs.join("\n")
    };

    let paragraph = Paragraph::new(text)
        .block(Block::default().borders(Borders::ALL).title("Logs"))
        .wrap(ratatui::widgets::Wrap { trim: true });

    f.render_widget(paragraph, area);
}
