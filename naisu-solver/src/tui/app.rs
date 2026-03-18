use std::collections::VecDeque;
use chrono::Local;
use ratatui::widgets::TableState;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum View {
    Logs,
    Transactions,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Chain {
    Sui,
    Avax,
    Solana,
    Base,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TxStatus {
    Pending,
    Success,
    Failed,
}

#[derive(Debug, Clone)]
pub struct Transaction {
    pub timestamp: String,
    pub chain: Chain,
    pub action: String,
    pub intent_id: String,
    pub sender: String,
    pub recipient: String,
    pub amount: String,
    pub status: TxStatus,
    pub tx_hash: String,
    pub explorer_url: String,
}

#[derive(Debug, Clone)]
pub enum AppEvent {
    Balance(Chain, String),
    Address(Chain, String),
    Tx(Transaction),
    Log(String),
    Shutdown,
}

pub struct App {
    pub active_view: View,
    pub should_quit: bool,
    pub table_state: TableState,

    pub start_time: std::time::Instant,

    // Balances
    pub sui_balance: String,
    pub eth_balance: String,
    pub sol_balance: String,

    // Addresses
    pub sui_address: String,
    pub evm_address: String,
    pub solana_address: String,

    // Transaction history (max 100)
    pub transactions: VecDeque<Transaction>,

    // Logs (max 1000 lines)
    pub logs: VecDeque<(chrono::DateTime<Local>, String)>,

    // Scroll state
    pub log_scroll: usize,
    pub auto_scroll: bool,
}

impl App {
    pub fn new() -> Self {
        Self {
            active_view: View::Logs,
            should_quit: false,
            table_state: TableState::default(),
            start_time: std::time::Instant::now(),
            sui_balance: "-".to_string(),
            eth_balance: "-".to_string(),
            sol_balance: "-".to_string(),
            sui_address: "-".to_string(),
            evm_address: "-".to_string(),
            solana_address: "-".to_string(),
            transactions: VecDeque::with_capacity(100),
            logs: VecDeque::with_capacity(1000),
            log_scroll: 0,
            auto_scroll: true,
        }
    }

    pub fn uptime_secs(&self) -> u64 {
        self.start_time.elapsed().as_secs()
    }

    pub fn toggle_view(&mut self) {
        self.active_view = match self.active_view {
            View::Logs => View::Transactions,
            View::Transactions => View::Logs,
        };
    }

    pub fn scroll_up(&mut self) {
        self.auto_scroll = false;
        self.log_scroll = self.log_scroll.saturating_add(1);
    }

    pub fn scroll_down(&mut self) {
        if self.log_scroll > 0 {
            self.log_scroll -= 1;
        }
        if self.log_scroll == 0 {
            self.auto_scroll = true;
        }
    }

    pub fn update_balance(&mut self, chain: Chain, amount: String) {
        match chain {
            Chain::Sui => self.sui_balance = amount,
            Chain::Avax | Chain::Base => self.eth_balance = amount,
            Chain::Solana => self.sol_balance = amount,
        }
    }

    pub fn update_address(&mut self, chain: Chain, address: String) {
        match chain {
            Chain::Sui => self.sui_address = address,
            Chain::Avax | Chain::Base => self.evm_address = address,
            Chain::Solana => self.solana_address = address,
        }
    }

    pub fn add_transaction(&mut self, tx: Transaction) {
        if self.transactions.len() >= 100 {
            self.transactions.pop_back();
        }
        self.transactions.push_front(tx);
    }

    pub fn add_log(&mut self, message: String) {
        if self.logs.len() >= 1000 {
            self.logs.pop_back();
        }
        self.logs.push_front((Local::now(), message));
        // If user has scrolled up, advance offset to keep the same log in view
        if !self.auto_scroll && self.log_scroll > 0 {
            self.log_scroll += 1;
        }
    }

    pub fn on_tick(&mut self) {}
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}
