var WisdmSocket=require('./wisdmsocket').WisdmSocket;
var DATABASE=require('./databasemanager').DATABASE;
var fs=require('fs');
var crypto=require('crypto');
var wisdmconfig=require('./wisdmconfig').wisdmconfig;
var TFSClient=require('./tfsclient.js').TFSClient;

function FileSystemClient() {
	this.setClientId=function(id) {m_client_id=id;};
	this.setSecretId=function(id) {m_secret_id=id;};
	this.setOwner=function(owner) {m_owner=owner;};
	this.connectToServer=function(host,port,callback) {_connectToServer(host,port,callback);};
	this.disconnectFromServer=function() {_disconnectFromServer();};
	this.connectionAccepted=function() {return m_connection_accepted;};
	this.isConnected=function() {if (m_socket) return true; else return false;};
	this.setDataPath=function(path) {m_data_path=path;};
	this.checkPaths=function(callback) {_checkPaths(callback);};
	this.onClose=function(callback) {m_close_handlers.push(callback);};
	this.closeWhenReady=function() {m_close_when_ready=true;};
	
	var m_client_id='';
	var m_secret_id='';
	var m_owner='';
	var m_connection_accepted=false;
	var m_socket=null;
	var m_data_path='';
	var m_last_action_timer=new Date();
	var m_close_handlers=[];
	var m_close_when_ready=false;
	
	function _connectToServer(host,port,callback) {
		m_socket=new WisdmSocket();
		console.log ('Connecting to '+host+' on port '+port);
		get_access_from_database(function(tmpA) {
			if (!tmpA.success) {
				callback(tmpA);
				return;
			}
			var access=tmpA.access||{users:[{user_id:'public'}]}; //for now we add public as a user by default - change this in future
			m_socket.connect(host,port,function(tmp1) {
				if (!tmp1.success) {
					m_socket=null;
					callback(tmp1);
					return;
				}
				console.log ('Connection established.');
				setTimeout(function() {
					if (!m_socket) return; //important!
					m_socket.sendMessage({
						command:'connect_as_file_system',
						client_id:m_client_id,
						owner:m_owner,
						secret_id:m_secret_id,
						access:access
					});
				},1000);
				callback({success:true});
			});
			m_socket.onMessage(function(msg) {
				m_last_action_timer=new Date();
				process_message_from_server(msg);
			});
			m_socket.onClose(function() {
				m_socket=null;
				m_connection_accepted=false;
			});
		});
	}
	function _disconnectFromServer() {
	}
	function _checkPaths(callback) {
		try {
			fs.mkdirSync(m_data_path);
		}
		catch(err) {
		}
		fs.exists(m_data_path,function(exists0) {
			if (!exists0) {
				callback({success:false,error:'Data path does not exist: '+m_data_path});
				return;
			}
			fs.stat(m_data_path,function(err,stat) {
				if (err) {
					callback({success:false,error:'Error in stat: '+err});
					return;
				}
				if (!stat.isDirectory()) {
					callback({success:false,error:'Data path is not a directory.'});
					return;
				}
				callback({success:true});
			});
		});
	}
	
	function periodic_check() {
		if (m_close_when_ready) {
			var elapsed_since_last_action=(new Date())-m_last_action_timer;
			if (elapsed_since_last_action>1000) {
				do_close();
				return;
			}
		}
		setTimeout(periodic_check,1000);
	}
	periodic_check();
	
	
	function do_close() {
		that.disconnectFromServer();
		setTimeout(function() {
			m_close_handlers.forEach(function(handler) {handler();});
		},1000);
	}
	
	
	function get_access_from_database(callback) {
		var DB=DATABASE('fs_'+m_client_id);
		DB.setCollection('admin');
		DB.find({_id:'access'},{},function(err,docs) {
			if (err) {
				callback({success:false,error:err});
				return;
			}
			callback({success:true,access:(docs[0]||{}).access||null});
		});
	}
	function process_message_from_server(msg) {
		if (!m_connection_accepted) {
			if (msg.command=='connection_accepted') {
				console.log ('CONNECTION ACCEPTED');
				m_connection_accepted=true;
			}
			else {
				console.error('Unexpected initial message from server: '+(msg.command||''));
				if (m_socket) {
					m_socket.close();
				}
			}
		}
		else {
			var server_request_id=msg.server_request_id||'';
			if (!server_request_id) {
				if (m_socket) m_socket.sendMessage({command:'error',message:'Unexpected empty server_request_id in messsage'});
				return;
			}
			else {
				try {
					handle_server_request(msg,function(resp) {
						resp.server_request_id=server_request_id;
						if (m_socket) {
							m_socket.sendMessage(resp);
						}
					});
				}
				catch(err) {
					console.error('Error handling server request: '+(msg.command||''));
					console.error(err);
					var resp={success:false,error:err.toString()};	
					resp.server_request_id=server_request_id;
					if (m_socket) m_socket.sendMessage(resp);
				}
			}
		}
	}
	
	function handle_server_request(request,callback) {
		if (!is_valid_data_path(m_data_path)) {
			callback({success:false,error:'invalid data path: '+m_data_path});
			return;
		}
		
		var command=request.command||'';
		
		console.log ('SERVER REQUEST: '+command);
		
		if (command=='getFileChecksum') {
			get_file_checksum(request.path,callback);
		}
		else if (command=='setFileChecksum') {
			set_file_checksum(request.path,request.checksum,callback);
		}
		else if (command=='readDir') {
			callback({success:false,error:'readDir not yet implemented'});
			//get_file_names(request,callback);
			
		}
		else if (command=='removeFile') {
			remove_file(_data_path+'/'+request.path,callback);
		}
		else if (command=='updateFileSystemSource') {
			var spawn=require('child_process').spawn;
			var git_process=spawn('/usr/bin/git',['pull'],{cwd:get_file_path(__dirname),stdio:'inherit'});
			git_process.on('close',function() {
				that.closeWhenReady();
			});
			callback({success:true});
		}
		else if (command=='setFileSystemAccess') {
			var DB=DATABASE(m_file_system_id);
			DB.setCollection('admin');
			DB.save({_id:'access',access:request.access},function(err) {
				if (err) {
					callback({success:false,error:err});
					return;
				}
				callback({success:true});
			});
		}
		else {
			callback({success:false,error:'Unrecognized or missing server request command: '+command});
		}
	}	
	function get_file_path(str) {
		if (!str) return '';
		var ind=str.lastIndexOf('/');
		if (ind>=0) return str.substr(0,ind);
		else return '';
	}
	function get_file_checksum(relpath,callback) {
		var stats=get_file_stats(m_data_path+'/'+relpath);
		if (!stats) {
			callback({success:false,error:'Unable to get stats for file, perhaps file does not exist.'});
			return;
		}
		var DB=DATABASE('fs_'+m_client_id);
		DB.setCollection('checksums');
		DB.find({_id:relpath},{checksum:1,mtime:1,size:1},function(err,docs) {
			if (err) {
				callback({success:false,error:err.message});
				return;
			}
			var doc=docs[0];
			if (doc) {
				if ((doc.mtime==stats.mtime)&&(doc.size==stats.size)) {
					next_step(doc.checksum);
					return;
				}
			}
			compute_file_checksum(m_data_path+'/'+relpath,function(tmpB) {
				if (!tmpB.success) {
					callback(tmpB);
					return;
				}
				DB.save({_id:relpath,checksum:tmpB.checksum,mtime:stats.mtime,size:stats.size},function(err) {
					if (err) {
						callback({success:false,error:err.message});
						return;
					}
					next_step(tmpB.checksum);
				});
			});
		});
		
		function next_step(checksum) {
			var TT=new TFSClient();
			TT.upload({path:m_data_path+'/'+relpath,checksum:checksum},callback);
		}
	}
	function set_file_checksum(relpath,checksum,callback) {
		if (!create_path_for_file(relpath)) {
			callback({success:false,error:'Unable to create path for file: '+relpath});
			return;
		}
		
		//first check to see if checksum already matches
		
		
		if (fs.existsSync(m_data_path+'/'+relpath)) {
			compute_file_checksum(m_data_path+'/'+relpath,function(tmp1) {
				if ((tmp1.success)&&(tmp1.checksum==checksum)) {
					//checksum already matches, no need to download
					callback({success:true});
				}
				else {
					fs.unlinkSync(m_data_path+'/'+relpath);
					next_step();
				}
			});
		}
		else next_step();
		
		function next_step() {
			var TT=new TFSClient();
			TT.download({path:m_data_path+'/'+relpath,checksum:checksum},callback);
		}
	}
	function compute_file_checksum(path,callback) {
		var hash=crypto.createHash('sha1');
		var stream=fs.createReadStream(path);
		stream.on('data',function(d) {hash.update(d);});
		stream.on('end',function() {callback({success:true,checksum:hash.digest('hex')});});
		stream.on('error',function(err) {callback({success:false,error:err.message});});
	}
	function get_file_stats(path) {
		var stats=fs.statSync(path);
		if (!stats) return null;
		return {size:stats.size,mtime:stats.mtime.toString()};
	}
	
	function is_valid_data_path(path) {
		if (!path) return false;
		return true;
	}
	function remove_file(path,callback) {
		fs.unlink(path,function(err) {
			if (err) callback({success:false,error:err.message});
			else callback({success:true});
		});
	}
	function create_path_for_file(relpath,basepath) {
		if (!basepath) basepath=m_data_path;
		var ind=relpath.indexOf('/');
		if (ind<0) return true;
		var str1=relpath.slice(0,ind);
		var str2=relpath.slice(ind+1);
		var path1=basepath+'/'+str1;
		if (!make_dir_if_needed(path1)) return false;
		return create_path_for_file(str2,path1);
	}
	function make_dir_if_needed(path) {
		
		if (is_directory(path)) return true;
		
		fs.mkdirSync(path);
		
		if (is_directory(path)) return true;
		
		
		return false;
	}
	function is_directory(path) {
		if (!fs.existsSync(path)) return false;
		stats=fs.statSync(path);
		return stats.isDirectory();
	}
	
}

setTimeout(function() {
	
	var prescribed_timeout=0;
	process.argv.forEach(function(arg0) {
		if (arg0.indexOf('timeout=')===0) {
			prescribed_timeout=Number(arg0.slice(('timeout=').length));
		}
	});
	var process_timer=new Date();
	console.log ('Prescribed timeout = '+prescribed_timeout);
	
	var CC=new FileSystemClient();
	CC.onClose(function() {
		console.log ('File system closed. exiting.');
		process.exit(0);
	});
	
	console.log('Setting client id: '+wisdmconfig.filesystemclient.client_id);
	CC.setClientId(wisdmconfig.filesystemclient.client_id);
	CC.setOwner(wisdmconfig.filesystemclient.owner||'');
	CC.setSecretId(wisdmconfig.filesystemclient.secret_id||'');
	CC.setDataPath(wisdmconfig.filesystemclient.data_path);
	console.log ('Initializing file system database...');
	
	step2();
	
	
	function step2() {
		CC.checkPaths(function(tmp) {
			if (!tmp.success) {
				console.error(tmp.error);
				process.exit(0);
			}
			step3();
		});
	}
	
	function step3() {
		if (process.argv.indexOf('--testconnection')>=0) {
			do_connect_to_server(function(tmp) {
				if (tmp.success) {
					console.log ('CONNECTION SUCCESSFUL');
				}
				else {
					console.error('Problem connecting to server: '+tmp.error);
					process.exit(0);
				}
				CC.disconnectFromServer();
				setTimeout(function() {
					if (tmp.success) process.exit(12);
					else process.exit(0);
				},1000);
				return;
			});
		}
		else {
			setTimeout(periodical_connect_to_server,100);
		}
	}
	
	function do_connect_to_server(callback) {
		console.log ('Connecting to server...');
		CC.connectToServer(wisdmconfig.filesystemclient.server_host,wisdmconfig.filesystemclient.server_port,function(tmp) {
			if (tmp.success) {
				console.log ('Connected to server ***.');
			}
			else {
				console.log ('Error connecting to server: '+tmp.error);
				callback({success:false,error:'Error connecting to server: '+tmp.error});
				return;
			}
			var timer=new Date();
			function check_connected() {
				if (CC.connectionAccepted()) {
					callback({success:true});
				}
				else {
					var elapsed=(new Date())-timer;
					if (elapsed>5000) {
						console.log ('Timeout while waiting for connection to be accepted.');
						callback({success:false,error:'Timeout while waiting for connection to be accepted.'});
						return;
					}
					else {
						setTimeout(check_connected,500);
					}
				}
			}
			setTimeout(check_connected,500);
		});
	}
	function periodical_connect_to_server() {
		if (prescribed_timeout>0) {
			var elapsed=(new Date())-process_timer;
			if (elapsed>prescribed_timeout) {
				CC.closeWhenReady();
			}
		}
		if (!CC.isConnected()) {
			do_connect_to_server(function(tmp) {
				setTimeout(periodical_connect_to_server,5000);
			});
		}
		else {
			setTimeout(periodical_connect_to_server,5000);
		}
	}
	
},100);
