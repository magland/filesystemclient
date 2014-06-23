/*
upload parameters, one of the following:
	* path (reads from file)
	* path,checksum (reads from file, already know the checksum)
	* data (uploads data)
	* data, checksum (uploads data, already know checksum)
download parameters, one of the following:
	* checksum,path (writes to file)
	* checksum (returns data)
*/

var fs=require('fs');

exports.TFSClient=TFSClient;

function TFSClient() {
	var that=this;
	
	this.upload=function(params,callback) {_upload(params,callback);};
	this.download=function(params,callback) {_download(params,callback);};
	
	var m_host=get_default_host()+':8005';
	
	function _upload(params,callback) {	
		//First we compute the checksum if that is needed
		if (!params.checksum) {
			if (params.data) {
				//compute the checksum from the data
				params.checksum=compute_data_checksum(params.data);
			}
			else if (params.path) {
				//compute the checksum from the file and recursively call _upload
				compute_file_checksum(params.path,function(tmp) {
					if (!tmp.success) {
						callback(tmp);
						return;
					}
					params.checksum=tmp.checksum;
					_upload(params,callback);
				});
				return;
			}
			else {
				callback({success:false,error:'Missig path or data parameters in upload'});
				return;
			}
		}
		
		
		if (!params.checksum) {
			callback({success:false,error:'Unexpected problem in upload'});
			return;
		}
		
		//check to see if file already exists on the server
		do_check(params.checksum,function(tmp) {
			if (!tmp.success) {
				callback(tmp);
				return;
			}
			if (tmp.exists) {
				console.log ('File already exists on the server');
				callback({success:true,checksum:params.checksum});
				return;
			}
			next_step();
		});
				
		function next_step() {
			
			//compute the content length
			var content_length=0;
			if (params.path) {
				content_length=get_file_size(params.path);
			}
			else {
				content_length=params.data.length;
			}
			
			if (!content_length) {
				callback({success:false,error:'Content length is zero, perhaps file does not exist: '+params.path});
				return;
			}
			
			//Send the data in a post request
			var REQ=require('http').request({
				host:m_host.split(':')[0],
				port:m_host.split(':')[1],
				method:'POST',
				path:'/upload?checksum='+params.checksum,
				headers:{"content-length":content_length}
			},function(RESP) {
				get_json_response(RESP,callback);
			});
			REQ.on('error',function(err) {
				callback({success:false,error:'Problem with POST request: '+err.message});
			});
			if (params.path) {
				//write the file data to the request
				var stream=fs.createReadStream(params.path);
				stream.on('data',function(dd) {
					REQ.write(dd);
				});
				stream.on('end',function() {
					REQ.end();
				});
			}
			else {
				//write the data to the request
				REQ.write(params.data);
				REQ.end();
			}
		}
	}
	function _download(params,callback) {
		var checksum=params.checksum;
		
		//check to see if file is really on the server
		do_check(checksum,function(tmp) {
			if (!tmp.success) {
				callback(tmp);
				return;
			}
			if (!tmp.exists) {
				callback({success:false,error:'File does not exist on server.'});
				return;
			}
			if (params.path) {
				//download and write the file
				do_download(checksum,params.path,callback);
			}
			else {
				//download and return the data
				do_download(checksum,'',callback);
			}
		});
		
	}
	
	function do_check(checksum,callback) {
		var REQ=require('http').request({
			host:m_host.split(':')[0],
			port:Number(m_host.split(':')[1]),
			method:'GET',
			path:'/check?checksum='+checksum
		},function(RESP) {
			get_json_response(RESP,callback);
		});
		REQ.on('error',function(err) {
			callback({success:false,error:'Problem with request: '+err.message});
		});
		REQ.end();
	}
	function do_download(checksum,path,callback) {
		var REQ=require('http').request({
			host:m_host.split(':')[0],
			port:m_host.split(':')[1],
			method:'GET',
			path:'/download/'+checksum+'.dat'
		},function(RESP) {
			
			//get the content type so we can check whether the request was successful
			var content_type=RESP.headers['content-type'];
			if (content_type=='application/json') {
				//json response indicates an error
				get_json_response(RESP,callback);
			}
			else if (content_type=='application/octet-stream') {
				//this is the expected content type
				if (path) {
					//we are writing to a file
					var stream=fs.createWriteStream(path);
					RESP.on('data',function(chunk) {
						stream.write(chunk);
					});
					RESP.on('end',function() {
						//finished writing to the file
						callback({success:true});
					});
				}
				else {
					//we are returning the data
					var data_buffers=[];
					RESP.on('data',function(chunk) {
						data_buffers.push(chunk);
					});
					RESP.on('end',function() {
						//concatenate the chunks
						var data=Buffer.concat(data_buffers);
						callback({success:true,data:data});
					});
				}
			}
			else {
				callback({success:false,error:'Unexpected content type of response: '+content_type});
			}
		});
		REQ.on('error',function(err) {
			callback({success:false,error:'Problem with request: '+err.message});
		});
		REQ.end();
	}
	function get_json_response(RESP,callback) {
		var data='';
		RESP.setEncoding('utf8');
		RESP.on('data',function(chunk) {
			data+=chunk;
		});
		RESP.on('end',function() {
			try {
				var response=JSON.parse(data);
				callback(response);
			}
			catch(err) {
				callback({success:false,error:'Error parsing json response: '+data});
			}
		});
	}
	function get_file_size(path) {
		try {
			var stats=fs.statSync(path);
			return stats.size;
		}
		catch(err) {
			console.error('Problem computing file size: '+path+': '+err.message);
			return 0;
		}
	}	
	function compute_data_checksum(data) {
		var hash=require('crypto').createHash('sha1');
		hash.update(data);
		return hash.digest('hex');
	}
	function compute_file_checksum(path,callback) {
		var hash=require('crypto').createHash('sha1');
		var stream=fs.createReadStream(path);
		stream.on('data',function(d) {hash.update(d);});
		stream.on('end',function() {callback({success:true,checksum:hash.digest('hex')});});
		stream.on('error',function(err) {callback({success:false,error:err.message});});
	}
	function get_default_host() {
		var txt='';
		try {
			txt=require('fs').readFileSync('/home/magland/config.txt','utf8');
		}
		catch(err) {}
		if (txt.indexOf('development')===0) return 'localhost';
		else return 'realhub.org';
	}
}
