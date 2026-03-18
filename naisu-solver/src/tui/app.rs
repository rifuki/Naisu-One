use std::collections::VecDeque;
use chrono::Local;
use ratatui::widgets::TableState;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Chain {
    Sui,
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
    pub action: String,
    pub intent_id: String,
    pub amount: String,
    pub status: TxStatus,
}

#[derive(Debug, Clone)]
pub enum AppEvent {
    Balance(Chain, String),
    Address(Chain, String),
    Mode(Chain, String, String), // mode label ("WS"/"HTTP") + active URL
    Tx(Transaction),
    TxUpdate(String, TxStatus), // intent_id_prefix (8 chars), new status
    Log(String),
}

pub struct App {
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

    // Connection modes + active URLs
    pub evm_mode: String,
    pub sol_mode: String,
    pub sui_mode: String,
    pub evm_conn_url: String,
    pub sol_conn_url: String,
    pub sui_conn_url: String,

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
            should_quit: false,
            table_state: TableState::default(),
            start_time: std::time::Instant::now(),
            sui_balance: "-".to_string(),
            eth_balance: "-".to_string(),
            sol_balance: "-".to_string(),
            sui_address: "-".to_string(),
            evm_address: "-".to_string(),
            solana_address: "-".to_string(),
            evm_mode: "…".to_string(),
            sol_mode: "…".to_string(),
            sui_mode: "HTTP".to_string(),
            evm_conn_url: "-".to_string(),
            sol_conn_url: "-".to_string(),
            sui_conn_url: "-".to_string(),
            transactions: VecDeque::with_capacity(100),
            logs: VecDeque::with_capacity(1000),
            log_scroll: 0,
            auto_scroll: true,
        }
    }

    pub fn uptime_secs(&self) -> u64 {
        self.start_time.elapsed().as_secs()
    }

    pub fn scroll_up(&mut self) {
        self.auto_scroll = false;
        self.log_scroll = self.log_scroll.saturating_add(1);
    }

    pub fn scroll_down(&mut self) {
        self.log_scroll = self.log_scroll.saturating_sub(1);
        if self.log_scroll == 0 {
            self.auto_scroll = true;
        }
    }

    pub fn update_balance(&mut self, chain: Chain, amount: String) {
        match chain {
            Chain::Sui => self.sui_balance = amount,
            Chain::Base => self.eth_balance = amount,
            Chain::Solana => self.sol_balance = amount,
        }
    }

    pub fn update_address(&mut self, chain: Chain, address: String) {
        match chain {
            Chain::Sui => self.sui_address = address,
            Chain::Base => self.evm_address = address,
            Chain::Solana => self.solana_address = address,
        }
    }

    pub fn set_mode(&mut self, chain: Chain, mode: String, url: String) {
        match chain {
            Chain::Base => { self.evm_mode = mode; self.evm_conn_url = url; }
            Chain::Solana => { self.sol_mode = mode; self.sol_conn_url = url; }
            Chain::Sui => { self.sui_mode = mode; self.sui_conn_url = url; }
        }
    }

    pub fn add_transaction(&mut self, tx: Transaction) {
        if self.transactions.len() >= 100 {
            self.transactions.pop_back();
        }
        self.transactions.push_front(tx);
    }

    pub fn update_transaction_status(&mut self, id: String, status: TxStatus) {
        if let Some(tx) = self.transactions.iter_mut().find(|t| t.intent_id == id) {
            tx.status = status;
        }
    }

    pub fn add_log(&mut self, message: String) {
        if self.logs.len() >= 1000 {
            self.logs.pop_front(); // drop oldest
        }
        self.logs.push_back((Local::now(), message)); // newest at bottom
    }

    pub fn on_tick(&mut self) {}
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}
