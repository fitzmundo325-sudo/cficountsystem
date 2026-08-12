// Modalizer JS by Atomtech v1.3

// left: 37, up: 38, right: 39, down: 40,
// spacebar: 32, pageup: 33, pagedown: 34, end: 35, home: 36
var keys = {37: 1, 38: 1, 39: 1, 40: 1};


if(typeof(opened_modal) == 'undefined'){
	var opened_modal = [];
}


let REFRESH_HANDLER = undefined;
let isMinimized = false;

function preventDefault(e) {
  e.preventDefault();
}

function preventDefaultForScrollKeys(e) {
  if (keys[e.keyCode]) {
    preventDefault(e);
    return false;
  }
}

// modern Chrome requires { passive: false } when adding event
var supportsPassive = false;
try {
  window.addEventListener("test", null, Object.defineProperty({}, 'passive', {
    get: function () { supportsPassive = true; } 
  }));
} catch(e) {}

var wheelOpt = supportsPassive ? { passive: false } : false;
var wheelEvent = 'onwheel' in document.createElement('div') ? 'wheel' : 'mousewheel';

// call this to Disable
function disableScroll(elm) {
  elm.addEventListener('DOMMouseScroll', preventDefault, false); // older FF
  elm.addEventListener(wheelEvent, preventDefault, wheelOpt); // modern desktop
  elm.addEventListener('touchmove', preventDefault, wheelOpt); // mobile
  elm.addEventListener('keydown', preventDefaultForScrollKeys, false);
}

// call this to Enable
function enableScroll(elm) {
  elm.removeEventListener('DOMMouseScroll', preventDefault, false);
  elm.removeEventListener(wheelEvent, preventDefault, wheelOpt); 
  elm.removeEventListener('touchmove', preventDefault, wheelOpt);
  elm.removeEventListener('keydown', preventDefaultForScrollKeys, false);
}

var opened_modals = [];


function open_modal(link, custom_class=undefined, targetElm=undefined, dialog=false,onclose=undefined, prevent_reload = false){
	if (window.self !== window.top) {
		return console.warn("Modalizer not allowed inside iframe window");
	}
	let modal_iframe_con
	
	
	
	if(dialog){
		 modal_iframe_con = document.createElement("dialog");
		 modal_iframe_con.classList.add("native_dialoge");
		 
		 modal_iframe_con.addEventListener('cancel', (event) => {
			event.preventDefault();
		  });
		  
				 
	}else{
		modal_iframe_con = document.createElement("div");
	}
	
	
		modal_iframe_con.classList.add("modal_iframe_con");
	let modal_load = document.createElement("div");
		modal_load.classList.add("loading_frame");
		modal_load.innerHTML = "Loading";
	let modal_iframe = document.createElement("iframe");
		modal_iframe.classList.add("modal_iframe");
		modal_iframe.setAttribute("src",link);
	
	if(custom_class){
		let all_class = custom_class.split(",");
		for(each of all_class){
			modal_iframe_con.classList.add(each);
		}
		
		
	}	
	
	let extra = "";
	
	
	let close_button = document.createElement("div");
		close_button.classList.add("close_modal_rev");
		close_button.innerHTML = "<span class='fa fa-times normal primary_color_invert'></span>";
		close_button.setAttribute("onclick","close_modalizer(this)"+extra);
	
	//setup modal variables
	let modalID = document.getElementById("md_"+removeSpecialChars(link));
	
	if(modalID){
		let hasThis = modalID.classList.remove("minimized_modal");
		modalID.classList.remove("fade_out_circle");
		
		
		if(hasThis){
			modalID.classList.add("fade_in_top");
		}
		

	}
	
	if(modalID != null && prevent_reload == false){
		//should update the link instead of generating another one.
		modalID.getElementsByClassName("modal_iframe")[0].src = link;
		if(custom_class){
			modalID.classList.add(custom_class);
		}
	
		let pdata = {'id': modal_iframe_con.getAttribute('id'), time: 10};
		opened_modal.push(pdata);
		
		return modalID;
		
	}else if(modalID != null && prevent_reload){
		//should update the link instead of generating another one.
		if(custom_class){
			modalID.classList.add(custom_class);
		}
	
		let pdata = {'id': modal_iframe_con.getAttribute('id'), time: 10, 'prevent_reload': prevent_reload,};
		opened_modal.push(pdata);
		
		postMessageToModal(modalID.getAttribute("id"), "refreshEvent");
		
		return modalID;
	}else{
		modal_iframe_con.setAttribute("id","md_"+removeSpecialChars(link));
		modal_iframe_con.appendChild(close_button);
		modal_iframe_con.appendChild(modal_load);
		modal_iframe_con.appendChild(modal_iframe);
		
		try{
			if(targetElm){
				targetElm.appendChild(modal_iframe_con);

				
			}else{
				document.body.appendChild(modal_iframe_con);
				if(dialog){
					modal_iframe_con.showModal();
				}
			}
		}catch(e){
			document.body.appendChild(modal_iframe_con);	
			console.log('targetElm '+ targetElm +' was not found, ', 'Make sure it is a DOM element reference');
		}
	
		
	}
	let pdata = {'id': modal_iframe_con.getAttribute('id'), time: 10};
	opened_modal.push(pdata);

	
	
	//adds onremove Trigger if a function is passed
	
	if(typeof(onclose) == "function"){
			modal_iframe_con.addEventListener("beforeRemove", () => {
				//console.log("On remove trigger!");
				onclose();
		});
	}
	
	return modal_iframe_con;
	
	
	
	function removeSpecialChars(str) {
    // Use a regular expression to match any non-alphanumeric character
		return str.replace(/[^a-zA-Z0-9]/g, '');
	}
	
	
}

function close_modalizer(elm){
	let parent = elm.parentNode;
	parent.classList.add("fade_out_circle");
	parent.dispatchEvent(new CustomEvent("beforeRemove", { bubbles: true }));
		
    setTimeout(function() {
		
		try{
			parent.close();
		}catch(e){
			// console.log(e);
		}
		
		
        parent.remove();
    }, 500); // 0.5 second delay
}


function minimize_modalizer(elm){
	let parent = elm.parentNode;
	parent.classList.add("fade_out_circle");
	parent.dispatchEvent(new CustomEvent("beforeRemove", { bubbles: true }));
	
	let parent_id = parent.getAttribute("id");
	
	postMessageToModal(parent_id, "minimized");
	
    setTimeout(function() {
		
		try{
			parent.close();
		}catch(e){
			// console.log(e);
		}
		
		parent.classList.add("minimized_modal");
        // parent.remove();
    }, 500); // 0.5 second delay
}


//Communication
// Iframe (child) script
function postMessageToParent(message) {
    window.parent.postMessage(message, '*'); // '*' allows the message to be sent to any origin, or you can restrict it to a specific origin for security
}


function postMessageToModal(id,data){
	let ids = _("md_"+id) || _(id);
	
	let targetIframe = ids.getElementsByTagName("iframe")[0];
	
	if (targetIframe && targetIframe.contentWindow) {
		targetIframe.contentWindow.postMessage(data, "*");
	}
	
}


window.addEventListener('message', (event) => {
    // Optionally validate the origin here for security
    // if (event.origin !== 'https://your-iframe-origin.com') return;

	// console.log(event.origin);

	const iframes = document.getElementsByTagName('iframe');
	let originatingIframe = null;
	
		for (let i = 0; i < iframes.length; i++) {
            if (iframes[i].contentWindow === event.source) {
                originatingIframe = iframes[i];  // This is the iframe that sent the message
                break;
            }
        }
		
	
    // Handle the accepted messages
    const message = event.data;

    if (message === 'close') {
        closeModal(originatingIframe); // Calls the close() function
    } else if (message.startsWith('goToParent')) {
        const url = message.split(':')[1]; // Extract URL
        goToParent(url); // Calls the goToParent() function with the specified URL
    } else if (message.startsWith('openModal')) {
		
        let data = extractAfterColon(message); // Extract Data
		let options = {};
		function elm(id){
			return document.getElementById(id);
		}	
		
		
		
		function extractAfterColon(inputString) {
			const colonIndex = inputString.indexOf(':');

			// Extract the part after the first colon
			const jsonString = inputString.slice(colonIndex + 1).trim();

			// Parse the substring into a JSON object
			try {
				const jsonObject = JSON.parse(jsonString);
				return jsonObject;
			} catch (error) {
				console.error("Invalid JSON format:", error);
			}
		}
		
		try{
			console.log(data);
			options = JSON.parse(JSON.stringify(data));

		}catch(e){
			
			console.log(e);
		}
		//open a modal on the parent element
		// console.log(options);
        open_modal(options.link, options.custom_class, elm(options.target), options.dialog );

		
    }else if(message.startsWith('function')){
		let fname = message.split(':')[1];
		let params = message.split(':')[2];
		
		if(!inIframe()){
			return;
		};
		
		try{
			window[fname](params);
		}catch(e){
			console.warn("Failed to call function named: " + fname);
		}
		
		
	}else if(message.startsWith('OK')){
		//console.log(originatingIframe, "Status 200");
		__MONITOR_UNLOADED_MODALFRAME(originatingIframe);
	};
	
	if(message.startsWith('refreshEvent')){
		
		if(REFRESH_HANDLER != undefined){
			REFRESH_HANDLER();
		}
	}else if(message.startsWith('minimized')){
		isMinimized = true;
	}
	
});



// close a modal, based from iframe source
function closeModal(elmsrc) {
	if (window.self !== window.top) {
		return console.warn("Its not allowed inside iframe window");
	}	
	let close_link = (elmsrc.parentNode.getElementsByClassName("close_modal_rev")[0]);
	close_modalizer(close_link);
}

function goToParent(url) {
	if (window.self !== window.top) {
		return console.warn("Its not allowed inside iframe window");
	}
	
    console.log('Navigating parent to:', url);
    window.location.href = url; // Navigates the parent window to the given URL
}


if(typeof(zxf) == 'undefined'){
	let zxf = window.setInterval(__MONITOR_UNLOADED_MODALFRAME, 1000);
}



//Auto close if modal failed to handshake
function __MONITOR_UNLOADED_MODALFRAME(elm=undefined){
	
	if(opened_modal.length){
		if(elm != undefined){
			let responded = (getIndexById(opened_modal, elm.parentNode.getAttribute("id")));
			opened_modal.splice(responded,1);
		}
		
		for(each of opened_modal){
			each.time = each.time - 1;
			
			if(each.time < 1){
				try{
					if(_(each.id).checkVisibility() && each.prevent_reload == false){
						showToast("Failed to Load Page...");	
					}
					close_modalizer(_(each.id).getElementsByTagName("iframe")[0]);
				}catch(e){
					//--
				}
				opened_modal.splice(getIndexById(opened_modal, each.id), 1);
				
				
			}
			
		}
		
	}

	
	function getIndexById(array, id) {
		return array.findIndex(item => item.id === id);
	}
	
}



try{
	postMessageToParent("OK");
}catch(e){
	//--
}


// Override default refresh behaviors (F5, Ctrl+R)
document.addEventListener('keydown', function(e) {
    // F5 or Ctrl+R
    if (
        e.key === 'F5' ||
        e.keyCode === 116 ||
        (e.key.toLowerCase() === 'r' && e.ctrlKey)
    ) {
        e.preventDefault();

        if (inIframe()) {
            window.location.href = "";
        } else {
            window.location.reload();
        }

        return false;
    }
});

