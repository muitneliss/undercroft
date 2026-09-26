---
title: Public home and customer index
type: source
date: 2026-09-26
tags: []
source: docs/design/homepages.md
source_path: docs/design/homepages.md
source_hash: d2754ed7a939777986b5d276468971432fc0c2d41866cd7ac387e1e8bc04d06c
ingested: 2026-09-26
---

# Public home and customer index

# Public home and customer index

The public route introduces the immutable data path and links to sign-in and documentation. It renders without requiring a session; a resolved session opens the existing customer index. Root refusal parameters and signed authorization requests retain their sign-in behavior.

The customer index searches the server-authorized list by name or ID using accent-insensitive Vietnamese matching. The UI store owns only the transient filter, and the query cache owns rows. Platform administrators retain the existing creation form and get a shortcut to it. On phones, IDs sit below names so role and Open remain visible.

The selected Case Index composition reuses Undercroft's paper, typography, controls and book shell. Public-cover type sizes (a 4.5rem / 3.75rem / 2rem heading and a 1.5rem / 1.25rem lead) are local composition choices; the operating UI type ramp remains unchanged. It adds no operational statistics or sample customer data to the product.

The cover is the book seen from below and the one continuously moving surface ([[adr-0063-the-public-cover-moves-continuously]]). The whole home follows the reader's colour scheme ([[adr-0064-the-public-home-follows-the-reader-s-colour-scheme]]): light is the book as printed on the page stock, dark is the book inverted onto Ink from header to footer. The lamp lights the whole page ([[adr-0065-the-lamp-lights-the-whole-public-home]]), and the vault's arches run its whole length on one ground ([[adr-0066-one-ground-one-light-and-one-vault-for-the-public-home]]): the page scrolls over a vault fixed to the viewport while its text stays still. A canvas film draws the data path as the platform's rules (one gate, a create-only content-addressed lake, refusals kept struck, models feeding a report) and the reader's six steps from invitation to question, each threaded to the data it moved. The pointer is a lamp that turns the vault, lights what is near, tints the column under it and reads out a record's content address; pressing the flow runs it. The two ordered lists are the content; reduced motion holds one settled frame that still answers the lamp.
