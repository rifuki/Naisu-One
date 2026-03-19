# Mainnet Upgrade Blueprint: Gasless Off-Chain Intents

## Current Flaws (The "On-Chain Creation" Model)
Saat ini, arsitektur Naisu mengharuskan *user* menandatangani dan membayar *gas fee* untuk memanggil fungsi `createOrder` di *Smart Contract* EVM.
Kelemahan fatal model ini:
1. **User Bayar Gas**: *User* butuh modal ETH/Token Native hanya untuk *submit order*.
2. **Lambat**: *Backend* harus menuggu transaksi `createOrder` terkonfirmasi di *blockchain* sebelum bisa memulai RFQ.
3. **PGA (Gas Wars)**: *Solver* luar bisa langsung mengambil *order* dari *event* on-chain sebelum *backend* Naisu selesai memilih *solver* terbaik. *Solver* yang kalah akan mengalami transaksi *revert* dan rugi gas fee.

---

## The Ultimate Solution: Gasless Off-Chain Intents
Untuk *Mainnet*, kita akan merombak total ke standar industri mutakhir (*cutting-edge DeFi*) yang dipakai oleh UniswapX, CowSwap, dan 1inch Fusion. *User* **tidak pernah** berinteraksi langsung dengan *Smart Contract*.

### 1. User Flow (Frontend)
- **Zero Gas**: *User* tidak memanggil fungsi `createOrder` dengan dompetnya.
- **EIP-712 Signature**: *User* hanya menandatangani *cryptographic message* off-chain (EIP-712) yang berisi detail *intent*:
  `"Saya izin Smart Contract Naisu memindahkan 1 ETH dari dompet saya, JIKA DAN HANYA JIKA ada solver yang mengirimkan saya X SOL di chain Y dalam 5 menit."`
- **Permit2 / Native Permit**: Menggunakan arsitektur *Permit2* (Uniswap) atau EIP-2612. *User* hanya perlu bayar gas 1x di awal untuk *Approve* (atau 0x jika token mendukung `permit` native seperti USDC), setelah itu 1000x transaksi ke depannya murni via tanda tangan gratis.
- *Frontend* mengirim *signature* gratis ini ke *Backend* Naisu.

### 2. Matching Engine (Backend)
- *Backend* menerima *intent* beserta *signature* dari *user*.
- *Backend* langsung menyebar info order ini ke para *solver* (*Push RFQ*).
- *Solver* membalas dengan *quote* harga dan *ETA* terbaik.
- *Backend* menetapkan 1 pemenang dan mengirimkan `User Signature` tersebut **hanya kepada solver pemenang**.

### 3. Execution (Solver & Smart Contract)
- **Solver yang bayar gas**: *Solver* pemenang merakit transaksi yang memuat `OrderPayload` + `UserSignature` dan memanggil fungsi `executeIntent()` di Smart Contract Naisu.
- **Validasi On-Chain**: Smart Contract Naisu akan melakukan verifikasi:
  1. Apakah *Signature* valid dan dibuat oleh *User*?
  2. Apakah batas waktu (*deadline*) belum lewat?
  3. Apakah *solver* yang mengirim pesanan sesuai dengan parameter pemenang?
- Jika valid, Smart Contract menggunakan fungsi `permit` / *Approval* untuk menarik dana dari dompet *User* ke dompet *Solver*, sementara *Solver* berkewajiban melepaskan dana tujuan (SOL/SUI) ke dompet *User* di rantai tujuan.

---

## Todo List for Implementation
Jika fitur ini akan diimplementasi di sesi koding berikutnya, ini yang harus dikerjakan:

### \[Smart Contract\]
1. Hapus fungsi `createOrder` yang memaksa user deposit aset di awal.
2. Buat fungsi `executeIntent(Order calldata order, bytes memory signature)` yang hanya bisa dipanggil oleh *Solver*.
3. Implementasikan EIP-712 `DOMAIN_SEPARATOR` untuk verifikasi *signature* yang aman dari serangan *replay*.

### \[Backend\]
1. Buat endpoint baru `/api/v1/intent/submit-signature` untuk menerima EIP-712 *payload*.
2. Simpan order dalam memori *backend*, bukan mengambil data dari *indexer* blockchain.
3. Rombak *websocket/SSE* untuk menyiarkan status "*Order Matching*" sebelum dilempar ke *solver*.

### \[Frontend\]
1. Ganti `useSendTransaction` menjadi `useSignTypedData` dari Wagmi.
2. Modifikasi *Agent prompt* agar mereturn aksi "Sign Message" alih-alih "Sign Transaction".
3. Tampilkan UI *gasless* yang menegaskan ke pengguna bahwa biaya pembuatan order adalah: **FREE / 0 ETH**.
