# Public home and customer index

The public page at `/` introduces Undercroft's data path and links to `/sign-in` and
the documentation. A resolved session opens the existing customer index at
`/tenants`. The public introduction can render while the session is loading or the
server is unavailable. Authentication refusal parameters and signed authorization
requests still reach sign-in; the public route does not consume them.

The signed-in home searches only the customers returned by `tenants.list`. Names
and IDs match without case or Vietnamese diacritics, using the same folding as the
scope picker. The transient search belongs to the UI store; rows remain in the
query cache. A clear action restores the list. Only platform administrators see
the shortcut to the existing customer-creation form.

## Direction contract

THESIS: A public introduction leads into a working customer index. The page shows
the path from sources to original data, user-authored models and reports.

OWN-WORLD: The existing paper, Archivo, Garamond, mono data, ruled rows and division
tabs remain authoritative. No new illustration, palette or font is introduced.
The public cover uses local composition sizes: a 5rem desktop / 2rem phone heading,
a 1.5rem desktop / 1.25rem phone lead, and 1rem stage titles. These do not change the
operating UI's type ramp in `apps/ui/DESIGN.md`.

STORY: A visitor understands the platform and signs in with an invitation. A
returning operator finds a customer and opens its book.

FIRST VIEWPORT: A centered two-line public headline sits above sign-in, documentation
and a four-column data path. The app has a margin heading, search, a ruled customer
table and a platform administrator's creation shortcut. On phones the public path
stacks; customer IDs move under their names so roles and the Open action stay visible.

FORM: The Case Index, selected as option 2 from the displayed concept images.
Grounded candidate 1 from surface seed `304a03b7`. The mock's decorative concept
label and illustrative customer data are not product content. The real book shell,
navigation terminology, permissions and brand mark take precedence over mock details.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish
review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
