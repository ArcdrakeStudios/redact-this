# Synthetic encrypted PDFs

These files contain one blank 72 × 72 point page and invented passwords. They
test rejection of AES-256 encrypted input, including an empty user password.
They contain no personal information and are excluded from release packages.

Generated with pypdf 6.10.0:

```python
from pypdf import PdfWriter

for label, password in [("encrypted-password", "synthetic-password"),
                        ("encrypted-empty-password", "")]:
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.encrypt(user_password=password, owner_password="synthetic-owner",
                   algorithm="AES-256")
    with open(label + ".pdf", "wb") as output:
        writer.write(output)
```

Encryption salts are random, so regeneration need not produce identical bytes.
