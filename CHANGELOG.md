# Changelog

## [1.3.0](https://github.com/muitneliss/undercroft/compare/v1.2.0...v1.3.0) (2026-09-18)


### Features

* **lint:** enforce handler -&gt; service -&gt; repo with ast-grep ([c0b3abb](https://github.com/muitneliss/undercroft/commit/c0b3abbf082ecf0284a318f0b5bffb6efd0d74d8))
* **lint:** one direction — handler → service → repo, enforced by ast-grep ([417be68](https://github.com/muitneliss/undercroft/commit/417be686b1ab277806db17ca8169409613491867))


### Bug Fixes

* **deploy:** apply the schema on deploy via a db-migrate service ([ea105ec](https://github.com/muitneliss/undercroft/commit/ea105eca8bf2ee57ff690672dff6dcf7c060f6ab))
* **deploy:** apply the schema on deploy, so services never start without their tables ([0312b0c](https://github.com/muitneliss/undercroft/commit/0312b0cfca4c7585ae7754736f0c83333e9dbdba))

## [1.2.0](https://github.com/muitneliss/undercroft/compare/v1.1.0...v1.2.0) (2026-09-18)


### Features

* close the loop — invitations in the product, and the whole ring under test ([50d4607](https://github.com/muitneliss/undercroft/commit/50d4607bf792985e532b16f384173949cea3fd57))
* **control-plane:** invite-only sign-in with Google and an emailed code ([982e28f](https://github.com/muitneliss/undercroft/commit/982e28f3940b21e009a134d64194eb7ed3087453))
* **core:** add an EmailSender seam for one-time sign-in codes ([d00395f](https://github.com/muitneliss/undercroft/commit/d00395f1c35212162b8ce05350bd87b777aae5e2))
* **db:** add Better Auth's tables, their grants, and a way to apply migrations ([1427352](https://github.com/muitneliss/undercroft/commit/14273520f6682230ff1a94fc45f67beb88f314db))
* invite-only sign-in with Better Auth (Google + emailed code) ([b32330c](https://github.com/muitneliss/undercroft/commit/b32330c9987255cfb6790edbc148dd4d2515016e))
* **ui:** give Undercroft a device, and cut the icons from it ([ce204b7](https://github.com/muitneliss/undercroft/commit/ce204b7f99a76c741c180a2b745a97486dfeb424))
* **ui:** give Undercroft a device, and cut the icons from it ([07665e7](https://github.com/muitneliss/undercroft/commit/07665e77175fd509f92694f1b539cfbc6bdac2aa))
* **ui:** make sign-in live, with Google and a one-time code ([5a602dd](https://github.com/muitneliss/undercroft/commit/5a602ddcb623b2198b06e7a2a9a56570885ece4e))


### Bug Fixes

* **docs:** point the README device at raw URLs so it actually renders ([e91a5f3](https://github.com/muitneliss/undercroft/commit/e91a5f3dd81d11719a4eae63fc3c992b2fde2b43))
* **ui:** mount BrowserRouter so signed-in routes can resolve ([74fee20](https://github.com/muitneliss/undercroft/commit/74fee209eabd628dd6ae734e307528e4a207f7a6))

## [1.1.0](https://github.com/muitneliss/undercroft/compare/v1.0.0...v1.1.0) (2026-09-17)


### Features

* **ui:** adopt the impeccable design on the tRPC + Zustand architecture ([cbb59dc](https://github.com/muitneliss/undercroft/commit/cbb59dcd09c13624b0ad48ed084e34916c76f855))
* **ui:** adopt the impeccable design on the tRPC + Zustand architecture ([73cf759](https://github.com/muitneliss/undercroft/commit/73cf759ce5131a13b214e49f46966f57bd10da1f))


### Bug Fixes

* stop prettier failing on release-please's CHANGELOG ([685e980](https://github.com/muitneliss/undercroft/commit/685e980f87eda1eb74dd5b6068894350092bf75c))
* stop prettier from failing on release-please's CHANGELOG ([68268a6](https://github.com/muitneliss/undercroft/commit/68268a624962dd9094c540bcb0d0b8293a0408f0))

## [1.0.0](https://github.com/muitneliss/undercroft/compare/v0.2.0...v1.0.0) (2026-09-17)


### ⚠ BREAKING CHANGES

* complete rewrite. The Python platform built for one customer is replaced by a generic, MIT-licensed, 100% TypeScript platform.

### Features

* build and serve the control-plane SPA at the same origin ([3d12fe0](https://github.com/muitneliss/undercroft/commit/3d12fe04bd44162b445094b03feae4da28a5ef2f))
* build and serve the control-plane SPA at the same origin ([72a2ec8](https://github.com/muitneliss/undercroft/commit/72a2ec8a99b8f2a629bb8ae96c84093a1404d16c))
* deploy on release to Dokploy through the API ([4606b41](https://github.com/muitneliss/undercroft/commit/4606b41178bff7376579972caf9e2dcfadf3f62a))
* deploy on release to Dokploy through the API ([f973775](https://github.com/muitneliss/undercroft/commit/f9737759da7a382fd3e72134493218306ac44b92))
* rebuild as Undercroft, a generic open-source data platform ([0e20aca](https://github.com/muitneliss/undercroft/commit/0e20aca902aaee5d02534b8a420d0659855120b2))
* style the control-plane shell ([7d54806](https://github.com/muitneliss/undercroft/commit/7d54806a7f7398cd9c1a1e52e48a3cf623b79295))
* style the control-plane shell ([f8a5604](https://github.com/muitneliss/undercroft/commit/f8a560401c04e5dfc1de7e123e893853ca7c47a8))
* **ui:** tRPC React Query client, Zustand store, and a useState ban ([8eeb591](https://github.com/muitneliss/undercroft/commit/8eeb5917467dd7a7088a267f3ab896ca0b3a1410))
* **ui:** tRPC React Query client, Zustand store, and a useState ban ([4dd81bc](https://github.com/muitneliss/undercroft/commit/4dd81bccfc9813f114bf228a3b3f64094c27d366))


### Bug Fixes

* survive --wait on the init container and resolve the image tag in verify ([300a92a](https://github.com/muitneliss/undercroft/commit/300a92a04fb67d0df3ec1a4b1890db330f3dadf2))
* survive --wait on the init container and resolve the image tag in verify ([7210bbd](https://github.com/muitneliss/undercroft/commit/7210bbd091d886b855858d631ca3d8bc8037de31))
