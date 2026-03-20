-- Intent orders (indexed + injected gasless)
CREATE TABLE IF NOT EXISTS intent_orders (
    order_id          TEXT    PRIMARY KEY,
    chain             TEXT    NOT NULL,
    creator           TEXT    NOT NULL,
    recipient         TEXT    NOT NULL,
    destination_chain INTEGER NOT NULL,
    amount            TEXT    NOT NULL,
    amount_raw        TEXT    NOT NULL,
    start_price       TEXT    NOT NULL,
    floor_price       TEXT    NOT NULL,
    current_price     TEXT,
    deadline          INTEGER NOT NULL,
    created_at        INTEGER NOT NULL,
    status            TEXT    NOT NULL,
    intent_type       INTEGER NOT NULL,
    explorer_url      TEXT    NOT NULL DEFAULT '',
    fulfill_tx_hash   TEXT,
    is_gasless        INTEGER NOT NULL DEFAULT 0
);

-- Gasless intents (off-chain pending, signature stored for solver execute)
CREATE TABLE IF NOT EXISTS gasless_intents (
    intent_id         TEXT    PRIMARY KEY,
    creator           TEXT    NOT NULL,
    recipient         TEXT    NOT NULL,
    destination_chain INTEGER NOT NULL,
    amount            TEXT    NOT NULL,
    start_price       TEXT    NOT NULL,
    floor_price       TEXT    NOT NULL,
    deadline          INTEGER NOT NULL,
    intent_type       INTEGER NOT NULL,
    nonce             INTEGER NOT NULL,
    signature         TEXT    NOT NULL,
    status            TEXT    NOT NULL,
    submitted_at      INTEGER NOT NULL,
    winning_solver    TEXT
);
