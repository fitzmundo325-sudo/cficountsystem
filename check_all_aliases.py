from website import create_app, db
from website.models import ProductMaster, ProductAlias

app = create_app()

with app.app_context():
    # Check ALL aliases
    all_aliases = ProductAlias.query.all()
    print(f'Total aliases: {len(all_aliases)}')
    for a in all_aliases:
        print(f'  ID: {a.id}, Alias: "{a.alias_name}" -> Master: {a.master_product.description}')