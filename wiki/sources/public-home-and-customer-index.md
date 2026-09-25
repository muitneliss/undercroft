---
title: Public home and customer index
type: source
date: 2026-09-25
tags: []
source: docs/design/homepages.md
source_path: docs/design/homepages.md
source_hash: 1ebca5fe6156b16b33a4e802d23526c940fb1908f9964d8372c73a803880aaab
ingested: 2026-09-25
---

# Public home and customer index

The public route introduces the immutable data path and links to sign-in and documentation. It renders without requiring a session; a resolved session opens the existing customer index. Root refusal parameters and signed authorization requests retain their sign-in behavior.

The customer index searches the server-authorized list by name or ID using accent-insensitive Vietnamese matching. The UI store owns only the transient filter, and the query cache owns rows. Platform administrators retain the existing creation form and get a shortcut to it. On phones, IDs sit below names so role and Open remain visible.

The selected Case Index composition reuses Undercroft's paper, typography, controls and book shell. Public-cover type sizes are local composition choices; the operating UI type ramp remains unchanged. It adds no operational statistics or sample customer data to the product.
