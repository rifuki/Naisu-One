# Anchor 0.30.1 requires nightly-2025-01-01 for IDL generation.
# (proc_macro2::SourceFile was removed from nightly after 2025-01-01)
# RUSTUP_TOOLCHAIN must be set explicitly — anchor reads it to select
# the nightly toolchain for its internal IDL build subprocess.
ANCHOR := RUSTUP_TOOLCHAIN=nightly-2025-01-01 PATH="/opt/homebrew/opt/node@20/bin:$(PATH)" anchor

.PHONY: build build-no-idl deploy clean test

build:
	$(ANCHOR) build

build-no-idl:
	anchor build --no-idl

deploy:
	$(ANCHOR) deploy --provider.cluster devnet

test:
	$(ANCHOR) test --provider.cluster localnet

clean:
	cargo clean
