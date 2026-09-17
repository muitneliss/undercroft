"""The control plane: the surface customers connect their accounts through.

A second HTTP service, beside the worker rather than inside it. ADR 0004 records
why that is not the thing ADR 0003 rejected: this adds one container and no
second scheduler, no second execution engine and no plugin system. It configures
the worker; it does not become one.

The split matters operationally as well as architecturally. The worker holds the
pipeline lock and runs for minutes at a time; this process answers browsers. One
of them faces the internet through a Dokploy domain, and it is not the one that
can start a sync.
"""
