# Solver Refactor Plan - Feature-Based Architecture

## Target Structure
```
solver/
├── src/
│   ├── feature/              # Domain features (self-contained)
│   │   ├── listener/         # Chain listeners (Sui, EVM, Solana)
│   │   │   ├── mod.rs
│   │   │   ├── handler.rs    # Business logic
│   │   │   ├── route.rs      # HTTP routes (for API mode)
│   │   │   ├── sui.rs        # Sui listener impl
│   │   │   ├── evm.rs        # EVM listener impl
│   │   │   └── solana.rs     # Solana listener impl
│   │   ├── executor/         # Transaction execution
│   │   │   ├── mod.rs
│   │   │   ├── handler.rs
│   │   │   ├── sui.rs
│   │   │   ├── evm.rs
│   │   │   └── solana.rs
│   │   ├── auction/          # Dutch auction pricing
│   │   │   ├── mod.rs
│   │   │   ├── handler.rs
│   │   │   └── pricing.rs
│   │   ├── strategy/         # Profitability strategy
│   │   │   ├── mod.rs
│   │   │   ├── handler.rs
│   │   │   └── calculator.rs
│   │   ├── health/           # Health checks
│   │   │   ├── mod.rs
│   │   │   ├── handler.rs
│   │   │   └── route.rs
│   │   └── solver/           # Main solver orchestration
│   │       ├── mod.rs
│   │       ├── handler.rs
│   │       └── route.rs
│   ├── common/               # Shared utilities
│   │   ├── mod.rs
│   │   ├── response.rs       # API response types
│   │   ├── error.rs          # Error handling
│   │   ├── types.rs          # Shared types
│   │   └── server.rs         # HTTP server setup
│   ├── middleware/           # HTTP middleware
│   │   ├── mod.rs
│   │   ├── auth.rs           # Authentication
│   │   ├── trace.rs          # Request tracing
│   │   └── cors.rs           # CORS
│   ├── infrastructure/       # External dependencies
│   │   ├── mod.rs
│   │   ├── wormhole.rs       # Wormhole API client
│   │   ├── provider.rs       # Chain providers
│   │   └── db.rs             # Database (future)
│   ├── state.rs              # AppState with solver state
│   ├── route.rs              # Route aggregation
│   ├── config.rs             # Configuration
│   ├── lib.rs                # Library exports
│   └── main.rs               # Entry point
├── Cargo.toml
└── tests/                    # Integration tests
```

## Key Changes

### 1. Feature Module Pattern
Each feature contains:
- `mod.rs` - Module exports
- `handler.rs` - Business logic (use cases)
- `route.rs` - HTTP routes (Axum Router)
- Specific implementations

### 2. AppState Pattern
```rust
pub struct AppState {
    pub config: Arc<Config>,
    pub orders: Arc<RwLock<HashMap<String, Order>>>,
    pub solver_status: Arc<RwLock<SolverStatus>>,
    pub balances: Arc<RwLock<ChainBalances>>,
}
```

### 3. Handler Pattern
```rust
// feature/listener/handler.rs
pub async fn start_listeners(State(state): State<AppState>) -> impl IntoResponse {
    // Start all chain listeners
}

pub async fn get_listener_status(State(state): State<AppState>) -> Json<ListenerStatus> {
    // Return current status
}
```

### 4. Route Pattern
```rust
// feature/listener/route.rs
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/start", post(handler::start_listeners))
        .route("/status", get(handler::get_listener_status))
}
```

## Migration Steps

### Phase 1: Setup Structure
1. Create new directory structure
2. Move existing code to temporary locations
3. Setup `Cargo.toml` with Axum, Tokio, etc.

### Phase 2: Port Core Features
1. **Config** - Move to root, add env loading
2. **State** - Create AppState with RwLock<HashMap>
3. **Listener** - Port chain listeners to feature/listener/
4. **Executor** - Port executors to feature/executor/

### Phase 3: Add HTTP API
1. Add Axum routes
2. Implement handlers for:
   - GET /api/v1/orders (list orders)
   - GET /api/v1/orders/:id (get order)
   - POST /api/v1/solver/start (start solver)
   - POST /api/v1/solver/stop (stop solver)
   - GET /api/v1/solver/status (solver status)
   - GET /api/v1/balances (get balances)

### Phase 4: TUI Integration
1. TUI dashboard uses HTTP API instead of direct lib calls
2. Or keep both modes (headless + API + TUI)

## Benefits

1. **Modularity** - Each feature self-contained
2. **Testability** - Easy to test handlers in isolation
3. **Scalability** - Can add new features easily
4. **API-First** - HTTP API for external integration
5. **Type Safety** - Shared state with RwLock

## Example Usage After Refactor

```rust
// Start solver with HTTP API
cargo run -- --mode api --port 8080

// Query via HTTP
curl http://localhost:8080/api/v1/solver/status
curl http://localhost:8080/api/v1/orders
curl -X POST http://localhost:8080/api/v1/solver/start

// Or keep headless mode
cargo run -- --mode headless
```
