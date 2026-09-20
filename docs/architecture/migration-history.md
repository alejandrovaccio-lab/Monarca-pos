# Monarca POS — Migration History

## Purpose

This document records the canonical chronological order of database migrations. Migration directory names are Prisma migration identities and must not be renamed after a migration may have been applied to a database.

## Current history

| Order | Migration directory | Purpose |
|---|---|---|
| 0001 | `0001_v1_0_0` | Initial schema |
| 0002 | `0002_v1_0_1_auth_sessions` | Authentication sessions |
| 0003 | `0003_v1_0_2_order_pickup_flow` | Order / pickup flow |
| 0004 | `0004_v1_0_3_authorization_integrity` | Authorization integrity |
| 0005 | `0005_v1_0_4_authorization_approval_uniqueness` | Single approval per authorization request |
| 0006 | `0006_v1_0_5_authorization_execution_uniqueness` | Single execution per authorization |
| 0007 | `0007_v1_0_6_audit_log_immutability` | Audit log immutability |
| 0008 | `0008_v1_0_7_inventory_movement_reference_integrity` | Inventory movement reference uniqueness/integrity |
| 0009 | `0009_v1_0_8_inventory_movement_immutability` | Inventory movement immutability |
| 0010 | `0010_v1_0_9_inventory_movement_tenant_integrity` | Inventory movement tenant integrity |
| 0011 | `0011_v1_0_10_inventory_movement_employee_scope` | Employee/branch temporal scope |
| 0012a | `0012_v1_0_11_inventory_movement_quantity_semantics` | Inventory movement quantity semantics |
| 0012b | `0012_v1_0_11_inventory_movement_temporal_integrity` | Inventory movement temporal integrity |
| 0013 | `0013_v1_0_12_inventory_movement_created_at_integrity` | Inventory movement timestamp coherence |
| 0014 | `0014_v1_0_13_inventory_movement_semantic_integrity` | Inventory movement semantic/reference-type integrity |
| 0015a | `0015_v1_0_14_inventory_movement_unit_cost_integrity` | Optional inventory movement unit-cost integrity |
| 0015b | `0015_v1_0_14_inventory_movement_user_scope` | Inventory movement user/branch scope |
| 0016a | `0016_v1_0_15_inventory_balance_non_negative` | Non-negative inventory balance |
| 0016b | `0016_v1_0_15_inventory_movement_reference_target_integrity` | Inventory movement reference target integrity |
| 0017 | `0017_v1_0_16_inventory_balance_tenant_integrity` | Inventory balance tenant integrity |
| 0018 | `0018_v1_0_17_product_cost_immutability` | Product cost immutability |
| 0019 | `0019_v1_0_18_product_cost_value_integrity` | Product cost value integrity |
| 0020 | `0020_v1_0_19_product_cost_reference_integrity` | Product cost purchase reference target integrity |
| 0021 | `0021_v1_0_20_product_cost_purchase_temporal_integrity` | Product cost purchase/effective timestamp coherence |
| 0022 | `0022_v1_0_20_product_price_tenant_integrity` | Product price branch/product tenant integrity |
| 0023 | `0023_v1_0_21_product_price_value_integrity` | Product price value integrity |
| 0024 | `0024_v1_0_22_product_price_temporal_integrity` | Product price creation timestamp integrity; future effective dates remain allowed for scheduled pricing |
| 0025 | `0025_v1_0_23_product_price_effective_at_uniqueness` | Prevent duplicate price events at the same effective timestamp within a pricing scope |
| 0026 | `0026_v1_0_24_product_price_branch_product_scope` | Require enabled branch-product assignment for branch-specific prices |
| 0027 | `0027_v1_0_25_product_price_immutability` | Prevent updates/deletes of historical and scheduled price events |

## Important naming rule

There are legacy duplicate numeric prefixes (`0012`, `0015`, and `0016`). They are distinct Prisma migration directory names and therefore distinct migration identities. The duplicate prefixes are retained intentionally: renaming an existing migration can break Prisma's migration history for databases where that migration has already been applied.

From this point forward, new migrations must use a unique sequential prefix. The next migration is therefore:

`0028_v1_0_26_<descriptive_name>`

Do not reuse `0012`, `0015`, or `0016), and do not renumber historical migrations.
