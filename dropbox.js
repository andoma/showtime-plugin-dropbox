/**
 *  Copyright (C) 2011 Andreas Öman
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

(function(plugin) {

  var OAUTH_CONSUMER_KEY='wuqod6evftbfe5k';
  var OAUTH_CONSUMER_SECRET='mg4qqagy2ingdue';

  plugin.createService("Dropbox", "dropbox:browse:/", "other", true,
		       plugin.path + "dropbox.png");
  
  var store = plugin.createStore('authinfo', true);

  function auth(authreq) {

    if(!("token" in store) || !("secret" in store)) {
      var credentials = plugin.getAuthCredentials("Dropbox",
	"Login", true, null, true);

      var doc = showtime.httpGet("https://api.dropbox.com/0/token", {
	email: credentials.username,
	password: credentials.password,
	oauth_consumer_key: OAUTH_CONSUMER_KEY
      }, null, true);
      var result = showtime.JSONDecode(doc.toString());

      store.token  = result.token;
      store.secret = result.secret;
    }
    return authreq.oauthToken(OAUTH_CONSUMER_KEY, OAUTH_CONSUMER_SECRET,
			      store.token, store.secret);
  }

  plugin.addHTTPAuth("https://api.dropbox.com/0/.*", auth);
  plugin.addHTTPAuth("https://api-content.dropbox.com/0/.*", auth);

  plugin.addURI("dropbox:browse:(.*)", function(page, path) {

    page.type = "directory";
    var url = "https://api.dropbox.com/0/metadata/dropbox" + path;
    var json = showtime.httpGet(url)
    var doc = showtime.JSONDecode(json);

    page.loading = false;

    if(!doc.is_dir) {
      page.error("Browsing non directory item");
      return;
    }

    var title = doc.path.split('/')
    page.metadata.title = title.length ? title[title.length-1] : "Dropbox Root";

    for(var i = 0; i < doc.contents.length; i++) {

      var item = doc.contents[i];
      var title = item.path.split('/');
      title = title[title.length-1];

      if(item.is_dir) {
	page.appendItem("dropbox:browse:" + showtime.pathEscape(item.path),
			"directory", {
			  title: title
			});
      } else {
	var url = "https://api-content.dropbox.com/0/files/dropbox" + showtime.pathEscape(item.path);
	var type = item.mime_type.split('/')[0];
	page.appendItem(url, type, {
	  title: title
	});
      }
    }
  });

})(this);
