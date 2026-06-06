# Disclaimer

## No Warranty

Strawdmin is provided **"as is"** without warranty of any kind, express or implied. The authors and contributors accept no responsibility for:

- Data loss or corruption resulting from use of this software
- Unauthorized access to your database through misconfiguration or deployment error
- Damages of any kind arising from the use or inability to use this software

Use at your own risk. Always maintain independent backups of any database you connect Strawdmin to.

---

## Security Responsibility

Strawdmin is a **privileged tool** — any authenticated admin user has full read/write/delete access to every table in the connected database. You are responsible for:

- Keeping `JWT_SECRET` secret and sufficiently random (32+ characters)
- Running Strawdmin on a **private network or behind a reverse proxy with its own access controls** — it is not hardened for direct exposure to the public internet
- Using HTTPS in any non-local deployment (`SECURE_COOKIES=false` is for local HTTP only)
- Restricting which users can reach the Strawdmin instance at the network level

The built-in brute-force protection on the login endpoint is process-local and resets on restart. It is a supplemental safeguard, not a primary security boundary.

---

## Write-time Hashing

The **write-time hashing** feature applies a one-way cryptographic hash (SHA-256 or SHA-512) to a column value before writing it to the database. The plaintext you enter is never stored — only the resulting hash. This is intentional: the feature is designed so that support staff can update fields like passwords (which the application stores as hashes) by entering the new plaintext value, without needing to know the hash format manually.

The algorithm and optional salt column must match what your application uses for that field. Hashing is irreversible — once written, the original plaintext cannot be recovered from the database.

---

## No Affiliation

Strawdmin is an independent open-source project and is not affiliated with, endorsed by, or connected to the publishers of any database system it supports (PostgreSQL, MySQL, MariaDB, Microsoft SQL Server, SQLite, or their respective trademark holders).

The name "Strawdmin" and the straw hat logo are original creative works inspired by the Straw Hat Pirates from *One Piece* (© Eiichiro Oda / Shueisha). This project has no affiliation with or endorsement from Eiichiro Oda, Shueisha, or Toei Animation.

---

## Third-Party Dependencies

This software incorporates open-source packages, each subject to its own license terms. A full list is available in `package.json`. The authors make no representations about the security or correctness of third-party dependencies.
