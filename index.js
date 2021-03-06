var Promise = require('bluebird');

var exec = process.platform !== 'win32' ? require('child_process').exec : require('node-windows').elevate;

function run(cmd) {
  return new Promise(function(resolve, reject) {
    exec(cmd, function(err, stdout, stderr) {
      if (err) reject(err);
      else resolve(stdout.toString());
    });
  });
}

var _getDevice = function() {
  return new Promise(function(resolve, reject) {
    run('ifconfig')
      .then(function(output) {
        var re = /^([^\t:]+):(?:[^\n]|\n\t)*status: active/mg;
        var md, devices = [];
        while ((md = re.exec(output)) !== null) {
          devices.push(md[1]);
        }
        devices.length ? resolve(devices) : reject();
      })
      .catch(reject);
  });
};

var _getHardwarePorts = function() {
  return new Promise(function(resolve, reject) {
    _getDevice()
      .then(function(devices) {
        // 获取service列表
        run('networksetup -listallhardwareports')
          .then(function(output) {
            var hardwarePorts = [];
            for (var i = 0; i < devices.length; i++) {
              var md, re = new RegExp("Hardware Port: (.+?)\\nDevice: " + devices[i], 'm');
              if (md = re.exec(output)) {
                hardwarePorts.push(md[1]);
              }
            }
            hardwarePorts.length ? resolve(hardwarePorts) : reject();
          })
          .catch(reject);
      }).catch(reject);
  });
}

var _getCommands = function() {
  return new Promise(function(resolve, reject) {
    if (process.platform !== 'win32') {
      _getHardwarePorts()
        .then(function(hardwarePorts) {
          var cmds = [];
          var setups = [
            'sudo networksetup -setwebproxy "_service" _host _port',
            'sudo networksetup -setsecurewebproxy "_service" _host _port',
            'sudo networksetup -setwebproxystate "_service" on',
            'sudo networksetup -setsecurewebproxystate "_service" on'
          ];
          for (var i = 0; i < hardwarePorts.length; i++) {
            setups.map(function(item) {
              cmds.push(item.replace('_service', hardwarePorts[i]));
            });
          }
          cmds.length ? resolve(cmds) : reject();
        }).catch(reject);
    } else {
      resolve([
        'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f',
        'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d _host:_port /f',
        'netsh winhttp import proxy source=ie',
        'netsh winhttp set proxy _host:_port'
      ]);
    }
  });
};

exports.setProxyOn = function(host, port) {
  return new Promise(function(resolve, reject) {
    _getCommands()
      .then(function(cmds) {
        Promise.reduce(cmds, function(_, cmd) {
          cmd = cmd.replace('_host', host)
            .replace('_port', port);
          return run(cmd);
        }, null).then(resolve).catch(reject);
      });
  });
}

exports.setProxyOff = function() {
  return new Promise(function(resolve, reject) {
    if (process.platform !== 'win32') {
      var setups = [
        'sudo networksetup -setwebproxystate "_service" off',
        'sudo networksetup -setsecurewebproxystate "_service" off'
      ];
      _getHardwarePorts()
        .then(function(hardwarePorts) {
          var cmds = [];
          for (var i = 0; i < hardwarePorts.length; i++) {
            setups.map(function(item) {
              cmds.push(item.replace('_service', hardwarePorts[i]));
            });
          }
          if (cmds.length) {
            resolve(Promise.reduce(cmds, function(_, cmd) {
              return run(cmd);
            }, null));
          } else {
            reject();
          }
        });
    } else {
      var cmds = [];
      cmds.push('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /f');
      cmds.push('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /f');
      cmds.push('netsh winhttp reset proxy');
      resolve(Promise.reduce(cmds, function(_, cmd) {
        return run(cmd);
      }, null));
    }
  });
}