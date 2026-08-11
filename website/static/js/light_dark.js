const static_link = "/static/css/"; //static link for resources
var themes = ["coloring","coloring_dark"]; //css filenames
var css_elm = document.getElementById("theme");



try{
	if(_ == null){
	function _(ghf){
		return document.getElementById(ghf);
	}

	}
}catch(e){
		
function _(ghf){
		return document.getElementById(ghf);
	}	
		
}

var current_theme = localStorage.getItem('theme_mode');

if (current_theme == null || current_theme == ""){
	localStorage.setItem('theme_mode','normal');
	current_theme = localStorage.getItem('theme_mode');
}


function toggle_theme(b){
	try{
		if(current_theme == 'normal'){
			localStorage.setItem('theme_mode','dark');
			current_theme = localStorage.getItem('theme_mode');
			css_elm.href = static_link+themes[1]+".css";
			b.classList.add('change');
			
			//
		}else{
			localStorage.setItem('theme_mode','normal');
			current_theme = localStorage.getItem('theme_mode');
			css_elm.href = static_link+themes[0]+".css";
			b.classList.remove('change');
			
		}

	}catch(e){
		//--	
	}	
	save_to_server();	

    // Repaint all charts
	try{
		Object.values(chartInstances).forEach(c => c.update());
	}catch(e){
		//
	}

	
}

	
if(current_theme == 'dark'){
		css_elm.href = static_link+themes[1]+".css";	
	save_to_server();	
		//_("theme_button").classList.add("change");
		//
}else{
		css_elm.href = static_link+themes[0]+".css";
		save_to_server();		
}



function save_to_server(){
	
	
	
var form_data = new FormData();
	form_data.append("theme", current_theme);
var ajax_request = new XMLHttpRequest();
	ajax_request.onreadystatechange = function() {
	if (this.readyState == 4 && this.status == 200) {	
			if(this.responseText.length >= 1){									
				if(this.responseText == current_theme){
					 return;
				}			
			}else{
				console.log('error setting theme to server');
			}	
		}else if(this.readyState == 4 && this.status == 0){
				 console.log('set_theme is not found on the server');
			  };
		 }


	ajax_request.open("POST", "set_theme");
	ajax_request.send(form_data);


}

function monitorThemeChange(){
	let saved = localStorage.getItem('theme_mode');
	
	
	if(current_theme != saved){
		try{
			if(current_theme == 'normal'){
				localStorage.setItem('theme_mode','dark');
				current_theme = localStorage.getItem('theme_mode');
				css_elm.href = static_link+themes[1]+".css";
				b.classList.add('change');
				
				//
			}else{
				localStorage.setItem('theme_mode','normal');
				current_theme = localStorage.getItem('theme_mode');
				css_elm.href = static_link+themes[0]+".css";
				b.classList.remove('change');
				
			}
			

			try{
				Object.values(chartInstances).forEach(c => c.update());
			}catch(e){
				//
			}
			
			
			
		}catch(e){
			//--	
		}	
		
		
	}
	
	
	
	
}

window.setInterval(monitorThemeChange, 1300);


