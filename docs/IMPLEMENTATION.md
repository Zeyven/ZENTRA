# ZA Thera｜澜序 SaaS implementation contract

Brand: **ZA Thera｜澜序**. Description: **洗浴娱乐行业智慧运营系统**. Tagline: **让门店，自成秩序。** User-provided Jade logo. See `BRANDING.md`.

Independent application for saas.zephael.cn. Preserve all existing projects, running services, accounts, databases and installers. Do not import legacy credentials or data. New application id cn.zephael.zaspa.saas; initial version 1.0.0-rc.1.

Platform -> merchant -> stores -> authorized employee. Platform provisions merchant and one-time owner invite. Merchant-code + independent account namespace. Store-specific employee roles. Platform cannot see business data without a revocable, at-most-one-hour owner grant; configuration support never changes funds.

PostgreSQL 16 (supported Ubuntu 24.04 distribution package), Node 24, TypeScript, React, Vite, Electron, Socket.IO. Tenant and relationship checks plus forced RLS with non-owner, non-BYPASSRLS runtime credentials. No default tenant, no demo production records, no legacy global-HQ authentication.

Full existing feature parity: rooms/cashier/orders/payments/member assets/bookings/queue/clocks/payroll/inventory/transfers/reports/marketing/permissions/audit/devices/integrations. Each endpoint and UI module must have an evidence status. Copied source or passing build alone does not count as verified functionality.

Membership mode defaults to store; merchant-wide mode selected before members/transactions exist. Shared principal-before-bonus FIFO allocations record origin and spending stores; reversals undo exact allocations. Transactional concurrency, immutable ledger, offline inter-store reconciliation; no automatic split payment.

New cloud root /opt/za-spa-saas; API 127.0.0.1:8791, separate PostgreSQL 127.0.0.1:5433. API limits 768 MiB/60% CPU, database 1 GiB/60% CPU. New Nginx virtual host and HTTPS, old virtual host unchanged. Separate credentials and backup/rollback. Backup retention 30 days. Initial acceptance load 20 merchants / 5 stores each / 100 devices, conditional on measured capacity and old-service health.

No online subscriptions, cross-merchant shared identities/assets, offline cashier synchronization, legacy data migration, or copying user data. No production test merchants. New and old desktop applications must coexist.

## Evidence gates

Delivery requirement confirmed by the user on 2026-09-08: do not send installation packages or cloud access links before the complete SaaS scope and formal launch acceptance have passed. Internal builds and isolated test environments are validation artifacts only. During implementation, report meaningful progress and actionable blockers; a completed module, a successful build, or passing targeted tests is not final delivery.

Final delivery requires the gates below to have recorded evidence, including remaining feature parity, merchant isolation, money concurrency and recovery, backup restoration, coexistence and update testing, measured capacity, HTTPS deployment and legacy service health. Unknown or unverified external integrations must remain open; do not substitute simulated success or reduce the accepted scope to close a gate.

User scope clarification on 2026-09-08: payment/group-buy providers and physical devices (receipt printers, wristband readers, etc.) are not currently available. For this release, reserve their interfaces, configuration, tenant isolation and clear unconnected/error behavior. Live provider credentials and physical hardware integration are not release gates. Never simulate payment, redemption or printing success. Record external live verification as not performed under this explicit scope; internal business flows and deployment gates remain required. Continue working until all remaining gates pass rather than stopping after a completed module.

- [ ] Independent source and artifact identity; legacy baseline hashes preserved.
- [ ] PostgreSQL schema and non-privileged forced RLS tests.
- [ ] Merchant provisioning, owner activation, employee authorization and support grants.
- [ ] Full endpoint/UI feature parity and business regressions.
- [ ] Shared-wallet concurrency, allocations, reversals and reconciliation.
- [ ] Export/restore, jobs, callbacks, devices and realtime isolation.
- [ ] Browser and packaged desktop full-story verification.
- [ ] Load / backup restore / legacy service unchanged.
- [ ] New domain HTTPS deployment and final artifact verification.

This file records unfinished work explicitly; no unchecked gate may be presented as completed.
