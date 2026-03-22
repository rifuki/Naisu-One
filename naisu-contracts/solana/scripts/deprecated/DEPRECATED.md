# Deprecated Scripts

Scripts di folder ini sudah **tidak digunakan lagi** oleh solver dan akan dihapus
setelah program upgrade selesai (`plan_program_upgrade.md`).

## Status

| Script | Diganti dengan | Status |
|---|---|---|
| `marinade_stake.ts` | `solve_marinade_and_prove` (on-chain CPI) | Pending program upgrade |
| `jito_stake.ts` | `solve_jito_and_prove` (on-chain CPI) | Pending program upgrade |
| `jupsol_stake.ts` | `solve_stake_and_prove` (on-chain CPI) | ✅ Sudah tidak dipanggil |
| `kamino_stake.ts` | `solve_stake_and_prove` (on-chain CPI) | ✅ Sudah tidak dipanggil |

## Kenapa Deprecated

### Masalah dengan approach subprocess:

1. **Atomicity bug** — VAA diemit SEBELUM staking selesai. Jika subprocess gagal
   setelah VAA diemit, solver sudah bisa claim ETH tapi user tidak dapat token.

2. **Wrong proof** — VAA payload berisi `solver → solver` self-transfer, bukan
   bukti bahwa staking terjadi untuk user.

3. **Security** — Private key solver dioper ke child process via argv. Tidak ideal.

4. **Testability** — Subprocess tidak bisa di-unit test dengan clean.

### Solusi

Tambah instruction baru ke Solana program `intent-bridge-solana`:
- `solve_marinade_and_prove` — CPI ke Marinade → mSOL ke recipient → emit VAA
- `solve_jito_and_prove` — CPI ke Jito pool → jitoSOL ke recipient → emit VAA

Satu transaksi atomic. Kalau staking gagal → seluruh tx revert → VAA tidak diemit.

## Compiled files

`dist/marinade_stake.js` dan `dist/jito_stake.js` masih ada di `dist/` dan masih
dipanggil solver saat ini. Akan dihapus setelah program upgrade + solver refactor selesai.

## Yang TIDAK deprecated (masih dipakai)

Script-script unstake tetap dipakai karena butuh **user signature** dari browser:
- `marinade_liquid_unstake_tx.ts` — build unsigned tx, user sign di frontend
- `jito_unstake.ts` — build unsigned tx, user sign di frontend
- `jupsol_unstake.ts` — build unsigned tx, user sign di frontend
- `kamino_unstake.ts` — build unsigned tx, user sign di frontend
