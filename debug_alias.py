from website import create_app, db
from website.models import ProductMaster, ProductAlias, PosSold
from website.api_handles import _normalize_product_text, _get_product_alias_lookup

app = create_app()

with app.app_context():
    # Check if there was an alias for MARBLE BROWNIES BOX pointing to Classic Brownies Box
    classic = ProductMaster.query.filter(ProductMaster.description.ilike('%classic brownie%')).first()
    
    print('=== Classic Brownies Box Aliases ===')
    for a in classic.aliases:
        print(f'  Alias: "{a.alias_name}" -> Normalized: "{a.normalized_alias}" -> Master: {a.master_product.description}')
    
    # Check all aliases that contain 'marble'
    marble_aliases = ProductAlias.query.filter(ProductAlias.alias_name.ilike('%marble%')).all()
    print('\n=== All Marble Aliases ===')
    for a in marble_aliases:
        print(f'  Alias: "{a.alias_name}" -> Normalized: "{a.normalized_alias}" -> Master: {a.master_product.description}')
    
    # Check normalized names
    pos_marble = 'MARBLE BROWNIES BOX'
    pos_classic = 'CLASSIC BROWNIE BIG- BU'
    
    print(f'\nPOS Marble: "{pos_marble}" -> Normalized: "{_normalize_product_text(pos_marble)}"')
    print(f'POS Classic: "{pos_classic}" -> Normalized: "{_normalize_product_text(pos_classic)}"')
    
    master_classic = classic.description
    master_marble = ProductMaster.query.filter(ProductMaster.description.ilike('%marble brownie%')).first().description
    
    print(f'Master Classic: "{master_classic}" -> Normalized: "{_normalize_product_text(master_classic)}"')
    print(f'Master Marble: "{master_marble}" -> Normalized: "{_normalize_product_text(master_marble)}"')