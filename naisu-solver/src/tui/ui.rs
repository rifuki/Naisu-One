use ratatui::{
    layout::{Alignment, Constraint, Direction, Layout, Margin, Rect},
    style::{Color, Modifier, Style, Stylize},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Cell, Clear, Paragraph, Row, Table, Tabs, Wrap},
    Frame,
};

use crate::tui::app::{App, Tab, TxStatus};

pub fn draw(f: &mut Frame, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .margin(1)
        .constraints([
            Constraint::Length(3), // Header
            Constraint::Length(3), // Tabs
            Constraint::Min(10),   // Content
            Constraint::Length(3), // Footer
        ])
        .split(f.area());

    draw_header(f, app, chunks[0]);
    draw_tabs(f, app, chunks[1]);
    
    match app.current_tab {
        Tab::Balances => draw_balances(f, app, chunks[2]),
        Tab::Transactions => draw_transactions(f, app, chunks[2]),
        Tab::Logs => draw_logs(f, app, chunks[2]),
    }
    
    draw_footer(f, app, chunks[3]);
}

fn draw_header(f: &mut Frame, app: &App, area: Rect) {
    let header_text = format!(
        " 🔧 Intent Solver Dashboard | SUI: {} | AVAX: {} | SOL: {}",
        app.balances.iter().find(|(c, _)| c.to_string() == "SUI").map(|(_, b)| b.as_str()).unwrap_or("-"),
        app.balances.iter().find(|(c, _)| c.to_string() == "AVAX").map(|(_, b)| b.as_str()).unwrap_or("-"),
        app.balances.iter().find(|(c, _)| c.to_string() == "SOL").map(|(_, b)| b.as_str()).unwrap_or("-"),
    );

    let header = Paragraph::new(header_text)
        .style(Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))
        .alignment(Alignment::Center)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Cyan))
        );
    
    f.render_widget(header, area);
}

fn draw_tabs(f: &mut Frame, app: &App, area: Rect) {
    let tabs = Tabs::new(vec![
        Tab::Balances.to_string(),
        Tab::Transactions.to_string(),
        Tab::Logs.to_string(),
    ])
    .select(match app.current_tab {
        Tab::Balances => 0,
        Tab::Transactions => 1,
        Tab::Logs => 2,
    })
    .style(Style::default().fg(Color::White))
    .highlight_style(
        Style::default()
            .fg(Color::Green)
            .add_modifier(Modifier::BOLD)
            .add_modifier(Modifier::UNDERLINED),
    )
    .divider(Span::raw(" | "));

    f.render_widget(tabs, area);
}

fn draw_balances(f: &mut Frame, app: &App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(5)])
        .split(area);

    let balance_items: Vec<Line> = app.balances.iter().map(|(chain, balance)| {
        let color = match chain {
            crate::tui::app::Chain::Sui => Color::Blue,
            crate::tui::app::Chain::Eth => Color::Magenta,
            crate::tui::app::Chain::Avax => Color::Red,
            crate::tui::app::Chain::Solana => Color::Green,
        };
        
        Line::from(vec![
            Span::styled(
                format!("{} ", chain),
                Style::default().fg(color).add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!("{}", "█".repeat(20)),
                Style::default().fg(color),
            ),
            Span::raw(" "),
            Span::styled(
                balance,
                Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
            ),
        ])
    }).collect();

    let balance_block = Block::default()
        .title("💰 Wallet Balances (Auto-updates every 5s)")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Cyan));

    let paragraph = Paragraph::new(balance_items)
        .block(balance_block)
        .alignment(Alignment::Left);

    f.render_widget(paragraph, chunks[0]);
}

fn draw_transactions(f: &mut Frame, app: &App, area: Rect) {
    let header_cells = ["Time", "Chain", "Action", "Amount", "Status", "ID", "Explorer"]
        .iter()
        .map(|h| Cell::from(*h).style(Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)));
    
    let header = Row::new(header_cells)
        .style(Style::default().add_modifier(Modifier::BOLD))
        .height(1);

    let rows: Vec<Row> = app.transactions.iter().skip(app.scroll).take(20).map(|tx| {
        let status_color = match tx.status {
            TxStatus::Success => Color::Green,
            TxStatus::Pending => Color::Yellow,
            TxStatus::Failed => Color::Red,
        };

        let chain_color = match tx.chain {
            crate::tui::app::Chain::Sui => Color::Blue,
            crate::tui::app::Chain::Eth => Color::Magenta,
            crate::tui::app::Chain::Avax => Color::Red,
            crate::tui::app::Chain::Solana => Color::Green,
        };

        Row::new(vec![
            Cell::from(tx.timestamp.clone()),
            Cell::from(tx.chain.to_string()).style(Style::default().fg(chain_color)),
            Cell::from(tx.action.clone()),
            Cell::from(tx.amount.clone()),
            Cell::from(tx.status.to_string()).style(Style::default().fg(status_color)),
            Cell::from(format!("{}...", &tx.intent_id[..8])),
            Cell::from("🔗 Link".to_string()).style(Style::default().fg(Color::LightBlue)),
        ])
        .height(1)
    }).collect();

    let table = Table::new(
        rows,
        [
            Constraint::Length(10),
            Constraint::Length(10),
            Constraint::Length(12),
            Constraint::Length(15),
            Constraint::Length(12),
            Constraint::Length(12),
            Constraint::Length(10),
        ],
    )
    .header(header)
    .block(
        Block::default()
            .title(format!("📋 Transaction History ({} total, scroll: ↑↓)", app.transactions.len()))
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::Cyan)),
    );

    f.render_widget(table, area);
}

fn draw_logs(f: &mut Frame, app: &App, area: Rect) {
    let logs: Vec<Line> = app.logs.iter().skip(app.scroll).take(50).map(|log| {
        let color = if log.contains("❌") || log.contains("Error") {
            Color::Red
        } else if log.contains("✅") || log.contains("Success") {
            Color::Green
        } else if log.contains("⏳") || log.contains("Pending") {
            Color::Yellow
        } else if log.contains("🚀") {
            Color::Cyan
        } else {
            Color::Gray
        };
        
        Line::from(Span::styled(log, Style::default().fg(color)))
    }).collect();

    let logs_block = Block::default()
        .title(format!("📜 Solver Logs ({} total, scroll: ↑↓, press 'R' to refresh)", app.logs.len()))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Cyan));

    let paragraph = Paragraph::new(logs)
        .block(logs_block)
        .wrap(Wrap { trim: true });

    f.render_widget(paragraph, area);
}

fn draw_footer(f: &mut Frame, _app: &App, area: Rect) {
    let help_text = " TAB: Switch | ↑↓: Scroll | R: Refresh | Q: Quit ";
    
    let footer = Paragraph::new(help_text)
        .style(Style::default().fg(Color::White).bg(Color::DarkGray))
        .alignment(Alignment::Center);
    
    f.render_widget(footer, area);
}
