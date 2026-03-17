use std::collections::VecDeque;
use chrono::Local;
use ratatui::widgets::TableState;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Tab {
    Status = 0,
    Balances = 1,
    Transactions = 2,
    Logs = 3,
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
    pub active_tab: Tab,
    pub should_quit: bool,
    pub table_state: TableState,
    
    // Status
    pub start_time: std::time::Instant,
    pub active_intents: usize,
    
    // Balances
    pub sui_balance: String,
    pub eth_balance: String,
    pub sol_balance: String,
    
    // Addresses (derived from private keys)
    pub sui_address: String,
    pub evm_address: String,
    pub solana_address: String,
    
    // Transaction history (max 100)
    pub transactions: VecDeque<Transaction>,
    
    // Logs (max 1000 lines)
    pub logs: VecDeque<(chrono::DateTime<Local>, String)>,
}

impl App {
    pub fn new() -> Self {
        Self {
            active_tab: Tab::Status,
            should_quit: false,
            table_state: TableState::default(),
            start_time: std::time::Instant::now(),
            active_intents: 0,
            sui_balance: "-".to_string(),
            eth_balance: "-".to_string(),
            sol_balance: "-".to_string(),
            sui_address: "-".to_string(),
            evm_address: "-".to_string(),
            solana_address: "-".to_string(),
            transactions: VecDeque::with_capacity(100),
            logs: VecDeque::with_capacity(1000),
        }
    }
    
    pub fn uptime_secs(&self) -> u64 {
        self.start_time.elapsed().as_secs()
    }
    
    pub fn next_tab(&mut self) {
        self.active_tab = match self.active_tab {
            Tab::Status => Tab::Balances,
            Tab::Balances => Tab::Transactions,
            Tab::Transactions => Tab::Logs,
            Tab::Logs => Tab::Status,
        };
    }
    
    pub fn prev_tab(&mut self) {
        self.active_tab = match self.active_tab {
            Tab::Status => Tab::Logs,
            Tab::Balances => Tab::Status,
            Tab::Transactions => Tab::Balances,
            Tab::Logs => Tab::Transactions,
        };
    }
    
    pub fn set_tab(&mut self, tab: Tab) {
        self.active_tab = tab;
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
    }
    
    pub fn on_tick(&mut self) {
        // Could trigger periodic updates here
    }
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}
