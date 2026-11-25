#!/usr/bin/env python
"""
Migration script to add GlobalOracleConfig table.
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
        # Create GlobalOracleConfig table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS global_oracle_config (
                id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                lead_time INTEGER NOT NULL DEFAULT 1 CHECK (lead_time >= 0 AND lead_time <= 30),
                default_buffer_pct REAL NOT NULL DEFAULT 20.0 CHECK (default_buffer_pct >= 0 AND default_buffer_pct <= 200),
                min_order_override INTEGER,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_by INTEGER REFERENCES user(id)
            )
        """)
        print("Created global_oracle_config table")
        
        # Insert default config if empty
        cursor.execute("SELECT COUNT(*) FROM global_oracle_config")
        count = cursor.fetchone()[0]
        if count == 0:
            cursor.execute("""
                INSERT INTO global_oracle_config (lead_time, default_buffer_pct, min_order_override)
                VALUES (1, 20.0, NULL)
            """)
            print("Inserted default Oracle config")
        
        conn.commit()
        print("Migration completed successfully!")
        
        # Verify
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='global_oracle_config'")
        table_sql = cursor.fetchone()[0]
        print(f"\nTable SQL:\n{table_sql}")
        
        cursor.execute("SELECT * FROM global_oracle_config")
        for row in cursor.fetchall():
            print(f"Config row: {row}")
        
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