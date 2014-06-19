//rename this file to wisdmconfig.js and modify

var wisdmconfig={};

wisdmconfig.filesystemclient={
	client_id:'peregrineXX',
	data_path:'/home/magland/wisdm/peregrineXX/filesystem',
	owner:'magland',
	secret_id:'', //must be set, known only to the owner (and keep it a secret!)
	server_host:'wisdmhub.org',
	server_port:8083
};

exports.wisdmconfig=wisdmconfig;
