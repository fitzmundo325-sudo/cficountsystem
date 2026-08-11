// ItsAtomtech Utilities v1.5




if(typeof(make) == 'undefined'){
	make = function(df){
		return document.createElement(df);
	}
}

if(typeof(_) == 'undefined'){
	_ = function(df){
		return document.getElementById(df);
	}
}



if(typeof(tag) == 'undefined'){
	tag = function (tagName, root = document) {
	  // Return all elements that have the custom attribute [tag="..."]
	  return root.querySelectorAll(`[tag="${tagName}"]`);
	}
}


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}



function getparam(h){
    get_param = window.location.href

    var url = new URL(get_param)
    var param_value = url.searchParams.get(h);
    return param_value;
}



function get(name){
  const parts = window.location.href.split('?');
  if (parts.length > 1) {
    name = encodeURIComponent(name);
    const params = parts[1].split('&');
    const found = params.filter(el => (el.split('=')[0] === name) && el);
    if (found.length) return decodeURIComponent(found[0].split('=')[1]);
  }
}


var params = '';

function begin(){
	var parted = params.split('?');
	if(params.length > 1){
		return '&';
	}else{
		return '?';
	}
}

//Utilities
const utility = {
	//Spam Detect
  lastClickTime: 0,
  timeThreshold: 500, // Adjust this threshold as needed (in milliseconds)

//Spam button detector
  spammingJam: function() {
    const currentTime = Date.now();
    const elapsedTime = currentTime - this.lastClickTime;

    if (elapsedTime < this.timeThreshold) {
      // Button is being spammed
      return true;
    } else {
      // Button click is within the acceptable threshold
      this.lastClickTime = currentTime;
      return false;
    }
  },
  
 //Smooth Scroll to an Element
  smoothScroll: function(elm,align='center'){
	  
	  elm.scrollIntoView({ behavior: "smooth", block: align, inline: "nearest" });
	  
  },
  
  formatSafe: function(str){
		// Remove spaces and special characters
	  let stripped = str.replace(/[^\w\s]/gi, '').replace(/\s+/g, '');
	  // Convert to lowercase
	  let lowercase = stripped.toLowerCase();
	  return lowercase;  
  },
  
  dateNormalize: function(dtr){
		let options = {
			timeZone: "Asia/Manila",
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		};

		let formatter = new Intl.DateTimeFormat('en-CA', options); // format: YYYY-MM-DD
		let parts = formatter.formatToParts(new Date(dtr));

		let year = parts.find(p => p.type === 'year').value;
		let month = parts.find(p => p.type === 'month').value;
		let day = parts.find(p => p.type === 'day').value;

		return `${year}-${month}-${day}`;
  },
  
  //Returns the Date in formated like: Fri, 2024 MAR 1
  formatDate: function(dateString, simple=false) {
    const dateObject = new Date(dateString);
		if (isNaN(dateObject.getTime())) {
			return null; // Return null if the date is not valid
		} else {
			let options;
			if(simple){
				options = { year: 'numeric', month: 'short', day: 'numeric' };
			}else{
				options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
			}
			
		
			const formattedDate = dateObject.toLocaleDateString('en-US', options);
			return formattedDate;
		}
	},
	monthsSince: function(dateString) {
		const givenDate = new Date(dateString); // Parse the input date string
		const currentDate = new Date(); // Get the current date
		
		// Calculate the year and month differences
		const yearsDifference = currentDate.getFullYear() - givenDate.getFullYear();
		const monthsDifference = currentDate.getMonth() - givenDate.getMonth();
		
		// Total months difference
		return yearsDifference * 12 + monthsDifference;
	},
	  
	  
	  /**
	 * Pads a number with leading zeros until it reaches the desired length.
	 * @param {number|string} int - The number Nushi-sama wishes to pad.
	 * @param {number} numOfZeros - The total length of the resulting string (default is 4).
	 * @returns {string} The beautifully padded number :-P!
 */
	addZeros: function (int, numOfZeros = 4) {
	  //transforms number into a string, then fills the spatial void with '0's!
		return String(int).padStart(numOfZeros, '0');
	}
  
};




var shown = false;
var created = false;
function createDialogue_old(type,data){
	var body = document.body;
		if(shown){destroy_dia();};
	var dia = document.createElement('div');
		dia.className = "dialogue_con";
		dia.setAttribute('id','dai_con');
		
		switch(type){
		
		case "buy":
		
			dia.innerHTML = "<div class='dialogue_box'><span class='close_dia' onclick='destroy_dia()'>&times;</span> <span class='dia_title'>Order and Send Notification to the Shop owner?</span> <hr class='line_2'>"+ 
			
			"<button class='buy_button' onclick='place_order_buy("+data+")'> Proceed </button>"
			
			+" </div>"
		
			created = true;
		break;	
		case "comm":
		
			dia.innerHTML = "<div class='dialogue_box'><span class='close_dia' onclick='destroy_dia()'>&times;</span> <span class='dia_title'>Confirm and Send Notification to the User?</span> <hr class='line_2'>"+ 
			
			"<button class='buy_button' onclick='place_order_comm("+data+")'> Proceed </button>"
			
			+" </div>"
		
			created = true;
		break;	
		case "wait":
		
			dia.innerHTML = "<div class='dialogue_box'><span class='close_dia' onclick='destroy_dia()'>&times;</span> <span class='dia_title'> Working ... Please wait</span> <hr class='line_2'> </div>"
		
			created = true;
		break;	
		case "error":
		
			dia.innerHTML = "<div class='dialogue_box '><span class='close_dia' onclick='destroy_dia()'>&times;</span> <span class='dia_title'> "+data+"</span> <hr class='line_2'> </div>"
		
			created = true;
		break;		
		case "info":
		
			dia.innerHTML = "<div class='dialogue_box '><span class='close_dia' onclick='destroy_dia()'>&times;</span> <span class='dia_title'> "+data+"</span> <hr class='line_2'> </div>"
		
			created = true;
		break;
		case "custom" :
		
			dia.innerHTML = "<div class='dialogue_box'><span class='close_dia' onclick='destroy_dia()'>&times;</span>  "+data+" </div>"	
				
		
		break;
		default:
			
			console.log(type + " dialog not known");
			setTimeout(destroy_dia, 500);
		break;
		
		}
		
		
		
		
		
		if(created){
			shown = true;
			body.appendChild(dia);
		}
	
	
}


function createDialogue(type, data,config={}) {
    let body = document.body;
    if (shown) { destroy_dia(); }
    const dia = document.createElement('div');
    dia.className = "ns_modal_container_standard";
    dia.setAttribute('id', 'dai_con');

    // Define icon classes based on dialogue type
    let iconClass = "fa-info"; // Default icon is "info"
	
	let icontype = type;
		config.type ? icontype = config.type : false;
	
    switch (icontype) {
        case "error":
            iconClass = "fa-exclamation-circle"; // Error icon
            break;
        case "wait":
            iconClass = "fa-spinner fa-spin"; // Loading spinner
            break;
        case "info":
            iconClass = "fa-info-circle"; // Info icon
            break;
        case "success":
            iconClass = "fa-check-circle"; // Check icon
            break;
        case "confirm":
        case "remove_order":
        case "remove_record_data":
        case "remove_category":
        case "remove_barangay":
            iconClass = "fa-question-circle"; // Question mark for confirmation
            break;
    }

    // HTML template with dynamic icon and action buttons
    dia.innerHTML = `
        <div class="ns_container">
            <div class="ns_modal_content">
                <span class="fa ${iconClass} ns_modal_icon medium"></span>
                <p class='small'>${type === "custom" || type === "custom2" ? data : getMessage(type, data)}</p>
                <div class="choices_button">
                    ${getButtons(type, data)}
                    ${shouldShowCloseButton(type) ? '<button class="ns_button cancel" onclick="destroy_dia()">Close</button>' : ''}
                </div>
            </div>
        </div>`;

    if (type === "custom2") {
        const csCon = document.createElement('div');
        csCon.className = 'ns_modal_content';
        csCon.innerHTML = `<span class="fa ${iconClass} ns_modal_icon medium"></span>`;
        csCon.appendChild(data);
        dia.querySelector('.ns_container').innerHTML = "";
        dia.querySelector('.ns_container').appendChild(csCon); // Embeds the passed-in custom HTML
    }

    if (!shown) {
        shown = true;
        body.appendChild(dia);
    }

    function getMessage(type, data) {
        switch (type) {

            case "confirm":
                return data.message;
            case "remove_record_data":
                return "Confirm deletion of data?";
            case "remove_category":
                return "Confirm deletion of category.";
            case "remove_barangay":
                return "Are you sure to delete this item?";
            case "wait":
                return "Working... Please wait";
            case "error":
                return data;
            case "info":
                return data;
            case "success":
                return data;
            default:
                return "";
        }
    }

    function getButtons(type, data) {
        switch (type) {
            case "buy":
                return `<button class="ns_button" onclick="place_order_buy(${data})">Proceed</button>`;
            case "comm":
                return `<button class="ns_button" onclick="place_order_comm(${data})">Proceed</button>`;
            case "confirm":
                return `<button class="ns_button" onclick="${data.responseRec}='pass'">Yes</button>
                        <button class="ns_button cancel" onclick="${data.responseRec}='fail'">No</button>`;
            case "remove_order":
            case "remove_record_data":
            case "remove_category":
            case "remove_barangay":
                return `<button class="ns_button" onclick="sendDeleteBarangay(${data})">Delete</button>`;
            default:
                return ""; // No additional buttons for other types
        }
    }

    function shouldShowCloseButton(type) {
        return type !== "confirm" && type !== "custom" && type !== "custom2";
    }

    function capitalize(word) {
        return word.charAt(0).toUpperCase() + word.slice(1);
    }
}



var timeout = 1000000; // 1000000ms = 1000 seconds
var lib = function() {}; // Let's create an empty object 
function setFoo() {
    lib.foo = "bar"; // set the variable foo within the object lib to equal bar
}
// This is the promise code, so this is the useful bit
function ensureFooIsSet(timeout) {
    var start = Date.now();
    return new Promise(waitForFoo); // set the promise object within the ensureFooIsSet object
 
    // waitForFoo makes the decision whether the condition is met
    // or not met or the timeout has been exceeded which means
    // this promise will be rejected
    function waitForFoo(resolve, reject) {
        if (window.lib && window.lib.foo)
            resolve(window.lib.foo);
        else if (timeout && (Date.now() - start) >= timeout)
            reject(new Error("timeout"));
        else
            setTimeout(waitForFoo.bind(this, resolve, reject), 30);
    }
}



// Custom User Confirm
function askUser(messageText="Confirm action.",callback,argumentsList,extra={}){
	if(!argumentsList){
		console.error("You should pass the arguments list as 'arguments'. ", "This method can only be called inside functions.");
		return;
	}
	let datas = {
		message: messageText,
		responseRec: 'lib.foo',
	};
	lib.foo = undefined;
	
	if(_('_custom_cofirm_dialog')){
		show_custom_confirm(datas);
	}else{
		createDialogue('confirm',datas,extra);
	}
	

	// This runs the promise code
	ensureFooIsSet(timeout).then(function(){
		
		let customArgs = [];
		for(args of argumentsList){
			customArgs.push(args);
		}
		customArgs.push(lib.foo);
		
		callback.apply(callback, customArgs || []); 
		//callback(arguments);
		
		
	});
	
}

function show_custom_confirm(datas){
	_("_custom_cofirm_dialog").style.display = "flex";
	console.log(datas);
	
	
	
}


 
function log_out(){
	if(inIframe()){
		postMessageToParent("goToParent:logout");
	}else{
		go_to('logout');
	}
}


function destroy_dia(){
	var dia = document.getElementById('dai_con');
	try{
		dia.remove();
		shown = false;
	}catch(e){
		//
	}
}



//Returns ellipsed string based on limit value
function charLimit(str, limit){
	if(str.length > limit){
		return str.slice(0,limit) + " ...";	
	}
	return str;
}


//remove Spcecial chars
function removeSpecialChars(str) {
  return str.replace(/[^a-zA-Z0-9 ]/g, '');
}


//Convert Underscores to spaces and Capitalize
function formatString(str) {
  if (!str) return "";
  
  const withSpaces = str.replace(/_/g, " ");
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

//Format a string into Privacy *** text 
function obfuscateText(str, asString = false) {
  if (typeof str !== "string") return null;

  const obfuscated = str
    .split(" ")
    .map(word => {
      if (word.length <= 2) return word; // too short to obfuscate

      const firstTwo = word.slice(0, 2);
      const lastChar = word.slice(-1);
      const stars = "*".repeat(word.length - 3);

      return firstTwo + stars + lastChar;
    })
    .join(" ");

  if (asString) {
    return obfuscated;
  }

  const span = document.createElement("span");
  span.textContent = obfuscated;
  span.setAttribute("original", btoa(str)); // base64 encode original text
  span.setAttribute("onclick", "toggleObfuscation(this)");
  span.classList.add("obfuscated_text");


  return span.outerHTML;
}

//function helper to get the original to show up
function toggleObfuscation(el) {
  const encoded = el.getAttribute("original");
  if (!encoded) return;

  const original = atob(encoded);

  // helper to obfuscate same way as before
  function obfuscate(str) {
    return str
      .split(" ")
      .map(word => {
        if (word.length <= 2) return word;

        const firstTwo = word.slice(0, 2);
        const lastChar = word.slice(-1);
        const stars = "*".repeat(word.length - 3);

        return firstTwo + stars + lastChar;
      })
      .join(" ");
  }

  // check current state
  if (el.textContent === original) {
    el.textContent = obfuscate(original);
  } else {
    el.textContent = original;
  }
}


function generatePagination(paginationData = undefined, callbackName , jumpNameCallback = undefined) {
    const container = document.createElement("div");

    let global_current = 1;

    try {
        global_current = page;
    } catch (e) {
        // --
    }

    const currentPage = paginationData?.current_page ?? global_current;
    const totalPages = paginationData?.total_pages ?? 1;

    // Create Prev button
    const prevPage = document.createElement("a");
    prevPage.textContent = "Prev page";
    if (currentPage > 1) {
        prevPage.setAttribute("onclick", `${callbackName}('prev')`);
    }else{
		prevPage.classList.add('disabled');
	}
    container.appendChild(prevPage);

    // Helper function to create a page link
    function createPageLink(pageNumber, isActive = false) {
        const pageLink = document.createElement("a");
        pageLink.textContent = pageNumber;
		
		if(paginationData == undefined){
			 pageLink.textContent = currentPage;
		}else{
			pageLink.textContent = pageNumber;
			
		}
		
        if (isActive) {
            pageLink.classList.add("active");
        }
        pageLink.setAttribute("onclick", `${jumpNameCallback}(${pageNumber})`);
        container.appendChild(pageLink);
    }

    // Generate pagination links based on total pages
    if (totalPages <= 5) {
        // Display all pages if 5 or fewer
        for (let i = 1; i <= totalPages; i++) {
            createPageLink(i, i === currentPage);
        }
    } else {
        // Truncate pages when totalPages > 5
        if (currentPage <= 3) {
            for (let i = 1; i <= 5; i++) {
                createPageLink(i, i === currentPage);
            }
            container.appendChild(document.createTextNode(" ... "));
            createPageLink(totalPages);
        } else if (currentPage >= totalPages - 2) {
            createPageLink(1);
            container.appendChild(document.createTextNode(" ... "));
            for (let i = totalPages - 4; i <= totalPages; i++) {
                createPageLink(i, i === currentPage);
            }
        } else {
            createPageLink(1);
            container.appendChild(document.createTextNode(" ... "));
            for (let i = currentPage - 1; i <= currentPage + 1; i++) {
                createPageLink(i, i === currentPage);
            }
            container.appendChild(document.createTextNode(" ... "));
            createPageLink(totalPages);
        }
    }

    // Create Next button
    const nextPage = document.createElement("a");
    nextPage.textContent = "Next page";
    if (currentPage < totalPages || paginationData == undefined) {
        nextPage.setAttribute("onclick", `${callbackName}('next')`);
    }else{
		nextPage.classList.add('disabled');
	}
    container.appendChild(nextPage);

    return container;
}