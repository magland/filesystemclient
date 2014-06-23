//rename this file to wisdmconfig.js and modify

var wisdmconfig={};

wisdmconfig.filesystemclient={
	client_id:'local',
	data_path:'/home/magland/filesystem',
	owner:'magland',
	secret_id:'', //must be set, known only to the owner (and keep it a secret!)
	server_host:'localhost',
	server_port:8004
};

exports.wisdmconfig=wisdmconfig;
