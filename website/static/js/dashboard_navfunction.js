/*
═══════════════════════════════════════

██╗   ██╗  ██████╗                 
██║   ██║       ╚██╗   	  ██████╗  
██║   ██║   █████╔╝    	 ██╔═══██╗ 
╚██╗ ██╔╝  ██╔═══╝     	 ██║   ██║ 
 ╚████╔╝   ███████╗  ██  ╚██████╔╝ 
  ╚═══╝    ╚══════╝       ╚═════╝    
 
═══════════════════════════════════════

*/

// --------------------------------------------------
function activate(elm){
	let parent_elm = elm.parentNode.parentNode;
	let all_active = parent_elm.getElementsByClassName("active");

	
	for(each of all_active){
		each.classList.remove("active");
	}
	elm.classList.add("active");
	
	
};



// ====================================
// Administration Section


function showUsersAdminView(elm){
	activate(elm);

	let page = open_modal("users_v2", 'modal_on_container,no_close_button,page_containment', _('general_container'),false, undefined, true);
	closeAllPages(page,false);
	hideDashboardContents(true);
	

	
}


function showProductMasterList(elm){
	activate(elm);

	let page = open_modal("product_masterlist", 'modal_on_container,no_close_button,page_containment', _('general_container'),false, undefined, true);
	closeAllPages(page,true);
	hideDashboardContents(true);
	

	
}



function showClusterPageAdmin(elm){
	activate(elm);

	let page = open_modal("clusters_v2", 'modal_on_container,no_close_button,page_containment', _('general_container'),false, undefined, true);
	closeAllPages(page,false);
	hideDashboardContents(true);
	

	
}






// Administration Section END
// ====================================




// Utilities
async function hideDashboardContents(hide=false){
	
	if(hide){
	_('header_title').classList.add("slideOut");
	await sleep(200);
	
	_('header_title').classList.add("hide_main_con");
	// _('dash_title_top').classList.add("hide_from_view");
		
	}else{
		_('header_title').classList.remove("slideOut");
		_('header_title').classList.remove("hide_main_con");
		// _('dash_title_top').classList.remove("hide_from_view");
		
	}

}


function closeAllPages(exclude=undefined,retain_elements=false){
	forceResize = true;
	
	let containment = _('general_container').getElementsByClassName('page_containment');
	
	try{
		hideDashboardContents(false);
	}catch(e){
		//--
	}
	for(each of containment){
		if(exclude){
			if(each.id == exclude.id){
				continue;
			}
		}
	
		let close_link = (each.getElementsByClassName("close_modal_rev")[0]);
		
		if(retain_elements){
			minimize_modalizer(close_link);
		}else{
			close_modalizer(close_link);
		}
		
	}
	
	try{
		closeSidebar();
	}catch(e){
		//---
	}
	
}

	

function closeSidebar(){
	document.documentElement.classList.remove('sidebar-open');
}


function toggleSidebarCollapse(){
	toggleMobileSidebar();
}


