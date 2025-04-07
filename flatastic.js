const axios = require('axios');

exports.Flatastic = function Flatastic(apikey) {
    this.apikey = apikey;

    Flatastic.prototype.request = function (url, option, cb) {
        axios.get(url, {
            headers: {
                "accept": "application/json, text/plain, */*",
                "accept-language": "de-CH,de;q=0.9,en-US;q=0.8,en-CH;q=0.7,en;q=0.6,ar-JO;q=0.5,ar;q=0.4,de-DE;q=0.3",
                "cache-control": "no-cache",
                "pragma": "no-cache",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-site",
                "x-api-key": this.apikey,
                "x-api-version": "2.0.0",
                "x-client-version": "2.3.20"
            }
        }).then(response => {
            cb(response.data);
        }).catch(error => {
            console.error("Error fetching data:", error);
            cb(null);
        });
    };

    Flatastic.prototype.getShoppingList = function (callback) {
        this.request('https://api.flatastic-app.com/index.php/api/shoppinglist', {}, callback);
    };

    Flatastic.prototype.getTaskList = function (callback) {
        this.request('https://api.flatastic-app.com/index.php/api/chores', {}, callback);
    };

    Flatastic.prototype.getInformation = function (callback) {
        this.request('https://api.flatastic-app.com/index.php/api/wg', {}, callback);
    };

    Flatastic.prototype.getStatistics = function (callback) {
        this.request('https://api.flatastic-app.com/index.php/api/chores/statistics', {}, callback);
    };

    Flatastic.prototype.checkTask = function (id, callback) {
        this.request(`https://api.flatastic-app.com/index.php/api/chores/next?id=${id}`, {}, callback);
    };

    Flatastic.prototype.getWG = function (callback) {
        this.request('https://api.flatastic-app.com/index.php/api/wg', {}, callback);
    };
};
