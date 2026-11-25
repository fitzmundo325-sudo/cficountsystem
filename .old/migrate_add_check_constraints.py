#!/usr/bin/env python
"""
Migration script to add CHECK constraints to oracle_order table.
SQLite doesn't support ALTER TABLE ADD CHECK, so we recreate the table.
"""
import sqlite3
import sys
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'instance', 'database.db')

def migrate():
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        return False
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        # Backup existing data
        cursor.execute("SELECT * FROM oracle_order")
        rows = cursor.fetchall()
        print(f"Backed up {len(rows)} existing orders")
        
        # Get column names
        cursor.execute("PRAGMA table_info(oracle_order)")
        columns = [row[1] for row in cursor.fetchall()]
        print(f"Columns: {columns}")
        
        # Drop old table
        cursor.execute("DROP TABLE oracle_order")
        print("Dropped old oracle_order table")
        
        # Create new table with CHECK constraints
        cursor.execute("""
            CREATE TABLE oracle_order (
                id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                store_id INTEGER NOT NULL REFERENCES store(id),
                product_id INTEGER NOT NULL REFERENCES product_master(id),
                order_date DATE NOT NULL,
                delivery_date DATE NOT NULL,
                quantity INTEGER NOT NULL CHECK (quantity >= 0),
                suggested_qty INTEGER NOT NULL DEFAULT 0 CHECK (suggested_qty >= 0),
                min_suggested_qty INTEGER NOT NULL DEFAULT 0 CHECK (min_suggested_qty >= 0),
                max_suggested_qty INTEGER NOT NULL DEFAULT 0 CHECK (max_suggested_qty >= 0),
                status VARCHAR(20) NOT NULL DEFAULT 'approved',
                created_by INTEGER NOT NULL REFERENCES user(id),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                approved_at DATETIME,
                reviewed_by INTEGER,
                reviewed_at DATETIME,
                approved_by INTEGER REFERENCES user(id),
                rejection_reason TEXT,
                approval_comment TEXT
            )
        """)
        print("Created new oracle_order table with CHECK constraints")
        
        # Recreate indexes
        cursor.execute("CREATE INDEX ix_oracle_order_store_delivery ON oracle_order(store_id, delivery_date)")
        cursor.execute("CREATE INDEX ix_oracle_order_store_status ON oracle_order(store_id, status)")
        cursor.execute("CREATE INDEX ix_oracle_order_store_order_date ON oracle_order(store_id, order_date)")
        cursor.execute("CREATE INDEX ix_oracle_order_store_product_order ON oracle_order(store_id, product_id, order_date)")
        print("Recreated indexes")
        
        # Restore data
        if rows:
            placeholders = ','.join(['?'] * len(columns))
            cursor.executemany(f"INSERT INTO oracle_order ({','.join(columns)}) VALUES ({placeholders})", rows)
            print(f"Restored {len(rows)} orders")
        
        conn.commit()
        print("Migration completed successfully!")
        
        # Verify
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='oracle_order'")
        table_sql = cursor.fetchone()[0]
        print(f"\nNew table SQL:\n{table_sql}")
        
        cursor.execute("PRAGMA index_list(oracle_order)")
        for row in cursor.fetchall():
            print('Index:', row)
        
        # Test constraint enforcement
        print("\nTesting CHECK constraint enforcement...")
        try:
            cursor.execute("INSERT INTO oracle_order (store_id, product_id, order_date, delivery_date, quantity, created_by) VALUES (1, 1, '2026-01-01', '2026-01-03', -1, 1)")
            print("ERROR: Negative quantity was allowed!")
            conn.rollback()
        except sqlite3.IntegrityError as e:
            print(f"OK: Negative quantity rejected: {e}")
        
        try:
            cursor.execute("INSERT INTO oracle_order (store_id, product_id, order_date, delivery_date, quantity, suggested_qty, created_by) VALUES (1, 1, '2026-01-01', '2026-01-03', 10, -5, 1)")
            print("ERROR: Negative suggested_qty was allowed!")
            conn.rollback()
        except sqlite3.IntegrityError as e:
            print(f"OK: Negative suggested_qty rejected: {e}")
        
        return True
        
    except Exception as e:
        print(f"Migration failed: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()

if __name__ == '__main__':
    success = migrate()
    sys.exit(0 if success else 1)