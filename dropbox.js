/**
 *  Copyright (C) 2011-2013 Andreas Öman
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */


var service = require('showtime/service');
var http    = require('showtime/http');
var sqlite  = require('showtime/sqlite');
var page    = require('showtime/page');

var OAUTH_CONSUMER_KEY='wuqod6evftbfe5k';
var OAUTH_CONSUMER_SECRET='mg4qqagy2ingdue';




function getdb() {
  var db = new sqlite.DB("mirror");
  return db;

}

var db = getdb();
db.upgradeSchema(Plugin.path + "/dbschema");
db.close();

service.create("Dropbox", "dropbox:browse:/", "other", true,
	       Plugin.path + "dropbox.png");

var store = require('showtime/store').create('authinfo');

function trace(str) {
  print("dropbox:", str);
}

function api(method, obj) {
  var v = http.request('https://api.dropbox.com/1/' + method, obj);
  return v ? JSON.parse(v) : null;
}

function reset(db) {
  db.query("DELETE FROM item");
  db.query('INSERT INTO item (id, parent, name) VALUES (1,1,"")');
  db.query("DELETE FROM cursor");
}


function auth(authreq) {

  // This function should return 'true' if we handled the request.
  // We should always do that even if something fails because nothing
  // else will be able to auth dropbox requests

  if(!("bearer" in store)) {
    var trap = 'http://localhost:42000/showtime/done';
    var auth = "https://www.dropbox.com/1/oauth2/authorize?" +
      "response_type=code&client_id=wuqod6evftbfe5k&" +
      "redirect_uri=" + trap;

    var o = Showtime.webpopup(auth, "Dropbox authentication", trap);

    if(o.result != 'trapped') {
      authreq.fail(o.result);
      return true;
    }

    if(o.args.not_approved) {
      authreq.fail('Not approved by user');
      return true;
    }

    var reply = api("oauth2/token", {
      postdata: {
        code: o.args.code,
        grant_type: 'authorization_code',
        client_id: 'wuqod6evftbfe5k',
        client_secret: 'mg4qqagy2ingdue',
        redirect_uri: 'http://localhost:42000/showtime/done'
      },
      debug: true,
      noAuth: true
    });

    if(reply.token_type != 'bearer') {
      authreq.fail('No bearer in reponse');
      trace("Invalid token reply: " + reply, 'dropbox');
      return true;
    }

    store.bearer = reply.access_token;
    var db = getdb();
    db.query("DELETE FROM path_to_url");
    reset(db);
    db.close();
  }
  return authreq.setHeader("Authorization", "Bearer " + store.bearer);
}
Showtime.httpInspectorCreate("https://api.dropbox.com/1/.*", auth);
Showtime.httpInspectorCreate("https://api-content.dropbox.com/1/.*", auth);


/**
 *  Get (or optionally create) a directory item
 */
function getDir(db, parent, name, create) {
  db.query("SELECT * FROM item WHERE parent=?1 AND name=?2", parent, name);
  var obj = db.step();
  if(obj || !create)
    return obj;

  db.query("INSERT INTO item (name, parent, is_dir)  VALUES (?1, ?2, 1)",
           name, parent);
  return {
    id: db.lastRowId,
    name: name,
    parent: parent
  }
}

/**
 * Update the local mirrored copy of dropbox metadata
 */
function updateMirror(db, forceUpdate) {

  var now = Date.now();

  do {
    var v;
    if(store.bearer) {
      db.query("SELECT * FROM cursor");
      v = db.step() || {};
    } else {
      v = {};
    }

    if(!forceUpdate && v.lastdelta && v.lastdelta + 500000 > now) {
      // No rescan
      return false;
    }

    trace("Refreshing local mirror");

    var resp = api('delta', {
      debug: true,
      postdata: {
        cursor: v.cursor
      }
    });

    if(resp.reset)
      reset(db);

    for(i in resp.entries) {
      var path = resp.entries[i][0].split('/');
      if(path.length == 0)
        continue; // Weird ???

      var metadata = resp.entries[i][1];

      var parentItem = { id:1 };

      var create = metadata !== null;
      for(var j = 1; j < path.length - 1 && parentItem; j++) {
        parentItem = getDir(db, parentItem.id, path[j], create);
      }
      if(!parentItem)
        continue;

      if(metadata) {
        db.query("INSERT OR REPLACE INTO item " +
                 "(parent, name, rev, thumb_exists, bytes, " +
                 "mtime, is_dir, icon, mime_type, root) " +
                 "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                 parentItem.id,
                 path[path.length - 1],
                 metadata.rev,
                 metadata.thumb_exists,
                 metadata.bytes,
                 typeof metadata.client_mtime == 'string' ?
                 Date.parse(metadata.client_mtime) / 1000: null,
                 metadata.is_dir,
                 metadata.icon,
                 metadata.mime_type,
                 metadata.root);
      } else {
        db.query("DELETE FROM item WHERE parent=?1 AND name =?2",
                 parentItem.id,
                 path[path.length - 1]);
      }
    }
    db.query("DELETE FROM cursor");
    db.query("INSERT INTO cursor (cursor,lastdelta) " +
             "VALUES (?1, ?2)",
             resp.cursor, now);
  } while(v.has_more);

  // Return true to commit transaction
  return true;
}

new page.Route("dropbox:info", function(page, args) {
  var db = getdb();
  updateMirror(db);
  db.close();
  page.type = "directory";
  page.loading = false;
  page.metadata.title = api('account/info').display_name + "'s dropbox";
});


function getItem(db, arg) {
  while(arg.charAt(0) == '/')
    arg = arg.substr(1);
  var path = arg.split('/');
  var item = { id:1, is_dir:true };
  for(var i = 0; i < path.length && item; i++)
    if(path[i])
      item = getDir(db, item.id, path[i]);
  return item;
}

new page.Route("dropbox:browse:(.*)", function(page, args) {

  var db = getdb();

  updateMirror(db);

  page.type = "directory";

  var parentItem = { id:1, is_dir:true };
  if(args && args != '/') {
    var path = args.split('/');
    for(var i = 1; i < path.length && parentItem; i++)
      parentItem = getDir(db, parentItem.id, path[i]);
  } else {

    page.metadata.title = api('account/info').display_name + "'s dropbox";
  }

  if(!parentItem) {
    page.error("No such file or directory");
    return;
  }

  if(!parentItem.is_dir) {
    page.error("Not a directory");
    return;
  }

  db.query("SELECT * FROM item WHERE parent=?1 ORDER BY name", parentItem.id);

  var row;
  while((row = db.step())) {
    if(row.id == 1)
      continue;
    if(row.is_dir) {
      page.appendItem("dropbox:browse:" + args + "/" + row.name,
                      "directory", {
                        title: row.name
                      });
    } else {
      var type = row.mime_type.split('/')[0];
      page.appendItem("dropbox://" + args + "/" + row.name,
                      type, {
                        title: row.name
                      });
    }
  }
  db.close();
  page.loading = false;
});


/*
plugin.addFileAccessProvider("dropbox", {
  open: function(path, mode) {
    if(mode != "read")
      return false;

    var r;
    var db = getdb();

    db.txn(function() {
      var now = showtime.time();
      db.query("SELECT * FROM path_to_url WHERE path=?1", path);
      r = db.step();
      if(r === false || r.expire < now) {
        r = api("media/dropbox" + path);
        if(r) {
          db.query("INSERT OR REPLACE INTO path_to_url " +
                   "(path, expire, urL) VALUES (?1,?2,?3)",
                   path, Date.parse(r.expires), r.url);
        }
      }
      return true;
    });
    db.close();
    return r.url;
  },

  stat: function(path) {
    var db = getdb();
    var item = getItem(db, path);
    db.close();
    if(!item)
      return null;
    var ret = {
      size: item.bytes,
      mtime: item.mtime,
      isDir: item.is_dir
    };
    return ret;
  },

  scandir: function(path) {
    var db = getdb();
    updateMirror(db);
    var item = getItem(db, path);

    db.query("SELECT * from item WHERE parent=?1", item.id);
    var row;
    var retval = [];
    while((row = db.step())) {
      if(row.id == 1)
        continue;
      retval.push({
        url: "dropbox://" + path + '/' + row.name,
        name: row.name,
        size: row.bytes,
        mtime: row.mtime,
        isDir: row.is_dir
      });
    }
    db.close();

    trace(retval);

    return {
      items: retval
    }
  }
});


*/
