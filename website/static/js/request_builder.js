//request builder v1.2
const qBuilder = {
	
	//params instances
	page: 1,
	maxPage: -1,
	
	sort: undefined,
	search: undefined,
	order_by: undefined,
	filters: {},
		
	//server communication
	server_address: undefined,
	request_method: 'POST', //can be: POST,  GET
	returnType: 'normal',
	row_limit: 100,
	// ================
	// Function -=-=-=-
	// ================
	
	
	paginate: function(dir, send=false){
		if(dir == 'prev'){
			this.page = qBuilder.limitRange(this.page-1, 1, this.maxPage)
		}else{
			this.page = qBuilder.limitRange(this.page+1, 1, this.maxPage)
		}	
		if(send){
			qBuilder.sendQuery();
		}		
		return this.page;		
	},
	
	
	
	sendQuery: function(func=undefined,customURL=undefined,customParams=[],errorHandler=undefined){
	let form_data = new FormData();
	// form_data.append('id', id);
	form_data.append('page', this.page);
	
	if(this.search){
		form_data.append('search', this.search);
	}	
	if(this.returnType){
		form_data.append('returnType', this.returnType);
	}	
	if(this.sort){
		form_data.append('sort', this.sort);
	}	
	if(this.order_by){
		form_data.append('order_by', this.order_by);
	}
	if(this.row_limit){
		form_data.append('row_limit', this.row_limit);
	}
	
	form_data.append('filters', JSON.stringify(this.filters));
	
	if(customParams){
		for(each of customParams){
			let nameP = each.name;
			let valueP = each.value || each.data;
			form_data.append(nameP, valueP);
			// console.log(each, valueP)
		}
	}
	
	
	
	let ajax_request = new XMLHttpRequest();
	ajax_request.onreadystatechange = async function() {
		if (this.readyState == 4 && this.status == 200) {		
			let responseData = JSON.parse(this.responseText);
			// console.log(responseData);
			try{
				func(this);
			}catch(e){
				console.log(e);
				qBuilder.server_response = this;
			}
			
			//await populateCategories(responseData); //Callback	

		}else if(this.readyState == 4 && this.status == 0){
			 createDialogue('error', "Server Connection error");

			try{
				errorHandler(this);
			}catch(e){
				//-
			}
			 
		}else if(this.readyState == 4 && this.status == 404){
			createDialogue('error', "Something went wrong!");
			try{
				errorHandler(this);
			}catch(e){
				//-
			}

			
		};
	}
	if(this.server_address == undefined){
		console.warn('server_address is undefined!');
		return;
	}
	
	if(customURL){
		ajax_request.open(this.request_method, customURL);
	}else{
		ajax_request.open(this.request_method, this.server_address);
	}
	
	
	ajax_request.send(form_data);
		
	},
	
	server_response: undefined,
	
	
	// utilities goes here
	
	limitRange: function(value, min, max=-1){
		value = parseInt(value);
		if(typeof(value) != 'number'){
			value = min
		}
		
		
		if(value < min){
			value = min
		}else if(max > 0 && value > max){
			value = max;
		}
		return value;
	},
	
	
	saveParamsLocal: function(params=undefined){
		let paramsToSave = params ?? ['page', 'sort', 'search', 'filters','order_by'];
		let paramStore = {};
		
		for(each of paramsToSave){
			if(qBuilder[each] != undefined){
				paramStore[each] = qBuilder[each];
			}
			
		}
				
		
		paramStore = JSON.stringify(paramStore);
		localStorage.setItem('paramStored',paramStore);
		
	},
	
	loadParamsLocal: function(params=undefined, retain=false){
		let paramsToSave = params ?? ['page', 'sort', 'search', 'filters','order_by'];
		let paramStore = {};
		let savedLocal = localStorage.getItem('paramStored');
		if(!savedLocal){
			return false;
		}
		
		savedLocal = JSON.parse(savedLocal);
		for(each of paramsToSave){
			if(qBuilder[each] != undefined){
			   qBuilder[each] = savedLocal[each] ;
			}
		}
		
		
		if(retain){
			return true;
		}
		
		localStorage.removeItem('paramStored');
		return true;
	},
	
	//Return an array of filters which is in readable form 
	formatFilters: function(filters=this.filters, parentKey, returnKeys = false) {
		parentKey = parentKey || '';
		var filterList = [];

		for (var key in filters) {
			if (
				filters.hasOwnProperty(key) &&
				key !== "sort" && // Ignoring the sort filter
				key !== "strict_status" && // Ignoring the strict_status filters
				filters[key] !== "all" // Ignoring filters with the value "all"
			) {
				var formattedKey = capitalizeFirstLetter(key.replace(/_/g, ' '));
				if (typeof filters[key] === 'object' && Object.keys(filters[key]).length > 0) {
					var nestedFilters = this.formatFilters(filters[key], key, returnKeys);
					if (returnKeys) {
						filterList.push({ key: key, value: formattedKey + ': (' + nestedFilters.map(item => item.value).join(', ') + ')' });
					} else {
						filterList.push(formattedKey + ': (' + nestedFilters.join(', ') + ')');
					}
				} else if (typeof filters[key] === 'string' && filters[key].trim() !== '') {
					var filterValue = formattedKey + ': ' + capitalizeFirstLetter(filters[key]);
					if (returnKeys) {
						filterList.push({ key: key, value: filterValue });
					} else {
						filterList.push(filterValue);
					}

					var currentindex = filterList.length - 1;
					try {
						if (!returnKeys) {
							filterList[currentindex] = preProcessEvent(key, filterList[currentindex], formattedKey);
						} else {
							var processed = preProcessEvent(key, filterList[currentindex].value, formattedKey);
							filterList[currentindex].value = processed;
						}
					} catch (e) {
						// No Process event
						console.log(e);
					}

				} else if (typeof filters[key] === 'object') {
					// Skipping empty object notation as per previous instruction
				}
			}
		}
				
		function capitalizeFirstLetter(string) {
			return string.charAt(0).toUpperCase() + string.slice(1);
		}

    return filterList;
	}

	

	
}

// misc codes

let firstLoad = true;
function monitorChanges(key="shouldReload",loader=undefined){
	let timer_c = setInterval(check, 2000);
	function check(){
		if(firstLoad){
			firstLoad = false;
			return;
		}
		let rl = localStorage.getItem(key);
		if(rl == 'true'){
			localStorage.removeItem(key);
			
			if(loader == undefined){
				
				if(typeof(loadRecords) != 'undefined'){
					qBuilder.sendQuery(loadRecords);
				}
				
			}else{
				qBuilder.sendQuery(loader);
			}
			
		}
	}
}


function accessProperty(obj, propString) {
  let properties = propString.split('.');
  let result = obj;
	try{
	  for (prop of properties) {
		result = result[prop];
		}
	}catch(e){
		return undefined;
	}

  return result;
}


function loadDataBind(objRoot){
	let allBinds = document.querySelectorAll('[databind]');
	
	for(each of allBinds){
		let stry = each.getAttribute('databind');
		let vals = accessProperty(objRoot, stry) ?? '';
		each.value = vals;
	}
	
}


function loadSavedParams(r){
	let saved = qBuilder.loadParamsLocal(undefined,r);
	if(saved){
		loadDataBind(qBuilder);
	}
	return saved;
}


function removeFilter(key){
	delete qBuilder.filters[key];
	loadDataBind(qBuilder);
	try{
		filter_apply_list(silent=true);
		generateFilterRibbons();
	}catch(e){
		//--
	}
	
}


