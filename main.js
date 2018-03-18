function isJsonValid(string) {
    try {
        JSON.parse(string);
    } catch (e) {
        return false;
    }
    return true;
}

async function getAjax (url) {
    return new Promise((resolve, reject) => {
        $.ajax(url)
            .done(result => resolve(result))
            .fail(error => reject(error))
    })
}

class Storage {

    static get applicationPrefix () {
        return 'tup1tsa'
    }

    static init() {
        let data = localStorage.getItem(Storage.applicationPrefix);
        Storage.checkStorageValidity();
        if (data !== null) {
            return;
        }
        data = {
            total: {},
            events: []
        };
        localStorage.setItem('tup1tsa', JSON.stringify(data))
    }

    static checkStorageValidity() {
        const data = localStorage.getItem(Storage.applicationPrefix);
        if (!isJsonValid(data)) {
            throw new Error('data in storage with key "tup1tsa" is invalid')
        }
    }

    static read(key) {
        Storage.checkStorageValidity();
        const myStorage = localStorage.getItem(Storage.applicationPrefix);
        return JSON.parse(myStorage)[key];

    }

    static write(key, data) {
        let myStorage = JSON.parse(localStorage.getItem(Storage.applicationPrefix));
        myStorage[key] = data;
        const storageString = JSON.stringify(myStorage);
        localStorage.setItem(Storage.applicationPrefix, storageString);
    }

}

class Analyzer {

    constuctor() {

    }

}

class ApiLinksGenerator {

    constructor(url) {
        this.parse(url);
        this.apiPrefix = '/api/v1/sportdata';
    }

    parse(url) {
        const regExp = /(events|race)\/([^\/]+)\/([^\/]+)/g;
        let result;
        while ((result = regExp.exec(url)) !== null) {
            const [, type, name, id] = result;
            this[type] = {name, id};
        }
        if (!this.events || !this.race) {
            throw new Error('Cannot parse this url')
        }
    }

    get event() {
        return `${this.apiPrefix}/events/event/${this.events.id}/`
    }

    get raceInfo() {
        return `${this.apiPrefix}/competitions/${this.events.id}/${this.race.id}/`
    }

    get raceResults() {
        return `${this.apiPrefix}/results/race/${this.race.id}/`
    }

}

class Event {

    static save(event) {
        event.races = [];
        if (Event.find(event.EventId)) {
            return;
        }
        let allEvents = Storage.read('events');
        allEvents.push(event);
        Storage.write('events', allEvents)
    }

    static find(eventId) {
        const allEvents = Storage.read('events');
        return allEvents.find((event) => event.EventId === eventId);
    }

    static findAllEvents() {
        return Storage.read('events')
    }

    static saveAllEvents(events) {
        Storage.write('events', events)
    }

}

class Race {

    static save(race, eventId) {
        if (!race.results) {
            race.results = []
        }
        let allEvents = Event.findAllEvents();
        let event = allEvents.find((event) => event.EventId === eventId);
        let raceFromStorage = event.races.find(currentRace => currentRace.RaceId === race.RaceId);
        if (raceFromStorage) {
            return;
        }
        event.races.push(race);
        Event.saveAllEvents(allEvents)
    }

    static saveResults(results, raceId, eventId) {
        let allEvents = Event.findAllEvents();
        let event = allEvents.find((event) => event.EventId === eventId);
        let raceFromStorage = event.races.find(currentRace => currentRace.RaceId === raceId);
        if (!raceFromStorage) {
            throw new Error('cannot save results for race without race info')
        }
        raceFromStorage.results = results;
        Event.saveAllEvents(allEvents)
    }

}

async function saveResultsFromUrl(url) {
    const linkGenerator = new ApiLinksGenerator(url);
    const requests = [
        getAjax(linkGenerator.event),
        getAjax(linkGenerator.raceInfo),
        getAjax(linkGenerator.raceResults)
    ];
    let eventsResponse, racesResponse, racesResultsResponse;
    try {
        [eventsResponse, racesResponse, racesResultsResponse] = await Promise.all(requests);
    } catch (err) {
        throw new Error('there were some problems fetching data from api')
    }
    try {
        // for some reason all fetched data from api comes in arrays, so here only first values of arrays are used
        const event = eventsResponse[0],
            race = racesResponse[0],
            raceResults = racesResultsResponse[0].Items;
        Event.save(event);
        Race.save(race, event.EventId);
        Race.saveResults(raceResults, race.RaceId, event.EventId);
    } catch (err) {
        throw new Error('There were some problems with saving race data')
    }
}

async function startApplication() {
    Storage.init();
    saveResultsFromUrl(window.location.href)
}

startApplication();