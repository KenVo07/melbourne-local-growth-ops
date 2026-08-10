# Security findings

- `app/server.py:20` — A live-format Stripe API key is hard-coded in source, exposing a reusable credential to anyone who can read the code.
- `app/server.py:21` — A weak administrative password is hard-coded in source, enabling trivial credential disclosure and guessing.
- `app/server.py:24` — The invoice endpoint has no authentication or tenant-ownership authorization check, allowing cross-tenant invoice access (IDOR).
- `app/server.py:31` — Attacker-controlled path parameters are interpolated into SQL, enabling SQL injection when the query executes on line 35.
- `app/server.py:42` — The payment webhook trusts an unsigned request body, allowing forged payment events to be applied.
- `app/server.py:51` — An attacker-controlled URL is fetched without destination validation, enabling SSRF against internal and metadata services.
- `app/server.py:59` — The original upload filename is joined directly to the destination path, enabling path traversal and arbitrary file overwrite.
- `app/server.py:60` — Uploaded files are saved without type or size validation, enabling dangerous-file upload and storage-exhaustion attacks.
- `app/server.py:64` — The administrative diagnostic endpoint has no authentication or authorization, exposing a privileged operation publicly.
- `app/server.py:68` — Attacker-controlled input is executed with `shell=True`, enabling arbitrary operating-system command execution.
- `app/server.py:73` — The Stripe API key is written to application output, leaking a sensitive credential through logs.
- `app/server.py:78` — Passwords are hashed with fast, collision-prone MD5 and no salt, making stolen password hashes inexpensive to crack.
