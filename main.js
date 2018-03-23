// depends on moment, moment-duration-format, jquery, lodash

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

class EventStorage {

    static save(event) {
        event.races = [];
        if (EventStorage.find(event.EventId)) {
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
}

class RaceStorage {

    static save(race, eventId) {
        if (!race.results) {
            race.results = []
        }
        let data = RaceStorage.findData(race.RaceId, eventId);
        if (data.raceFromStorage) {
            return;
        }
        data.event.races.push(race);
        Storage.write('events', data.allEvents)
    }

    static saveResults(results, raceId, eventId) {
        let data = RaceStorage.findData(raceId, eventId);
        if (!data.raceFromStorage) {
            throw new Error('cannot save results for race without race info')
        }
        data.raceFromStorage.results = results;
        Storage.write('events', data.allEvents)
    }

    static findData(raceId, eventId) {
        let allEvents = Storage.read('events');
        let event = allEvents.find((event) => event.EventId === eventId);
        let raceFromStorage = event.races.find(currentRace => currentRace.RaceId === raceId);
        return {allEvents, event, raceFromStorage}
    }

}

function parseCurrentUrl() {
    const regExp = /(events|race)\/([^\/]+)\/([^\/]+)/g;
    const url = window.location.href;
    let result;
    let eventId, raceId;
    while ((result = regExp.exec(url)) !== null) {
        const [, type, , id] = result;
        if (type === 'events') {
            eventId = id.toUpperCase();
        } else if (type === 'race') {
            raceId = id.toUpperCase();
        }
    }
    if (!eventId || !raceId) {
        throw new Error('Cannot parse this url')
    }
    return {eventId, raceId}
}

function generateLinks(eventId, raceId) {
    const apiPrefix = '/api/v1/sportdata';
    return {
        event:`${apiPrefix}/events/event/${eventId}/`,
        race: `${apiPrefix}/competitions/${eventId}/${raceId}/`,
        raceResults: `${apiPrefix}/results/race/${raceId}/`
    }
}


async function saveResultsFromCurrentPage() {
    const {eventId, raceId} = parseCurrentUrl();
    const links = generateLinks(eventId, raceId);
    const requests = [
        getAjax(links.event),
        getAjax(links.race),
        getAjax(links.raceResults)
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
        EventStorage.save(event);
        RaceStorage.save(race, eventId);
        RaceStorage.saveResults(raceResults, raceId, eventId);
    } catch (err) {
        throw new Error('There were some problems with saving race data')
    }
}

class Analyzer {

    constructor (results) {
        this.results = results;
    }

    createDuration (time) {
        let splitTime = time
            .split(':')
            .map(timeString => parseFloat(timeString));
        while (splitTime.length < 3) {
            splitTime.unshift(0)
        }
        const [hours, minutes, seconds] = splitTime;
        return moment.duration({hours, seconds, minutes})
    }

    removeShootPenalties() {
        this.results = this.results.map(result => {
            let resultCopy = _.clone(result);
            if (!result.TotalTime) {
                return resultCopy;
            }
            const totalTime = this.createDuration(result.TotalTime);
            const penaltiesTime = moment.duration(this.penaltyLoopSecs * result.ShootingTotal, 's');
            const pureTime = totalTime.subtract(penaltiesTime);
            resultCopy.pureTime = pureTime.format('hh:mm:ss.S');
            return resultCopy;
        });
    }

    sortByPureTime() {
        this.results = _.sortBy(this.results, 'pureTime')
    }

    logResults() {
        const results = this.results.map(result => {
            return {
                time: result.pureTime,
                name: result.Name
            }
        });
        console.table(results);
    }
}

class Sprint extends Analyzer{

    constructor (results) {
        super(results);
        this.penaltyLoopSecs = 25.5;
    }

    getPureResults() {
        this.removeShootPenalties();
        this.sortByPureTime();
        return this.results;
    }

}

class Pursuit extends Analyzer {
    constructor(results) {
        super(results);
        this.penaltyLoopSecs = 22.5;
    }

    getPureResults() {
        this.removeStartDifference();
        this.removeShootPenalties();
        this.sortByPureTime();
        return this.results;
    }

    removeStartDifference() {
        this.results = this.results.map(result => {
            let resultCopy = _.clone(result);
            if (!result.StartInfo || result.StartInfo === '0.0' || !result.TotalTime) {
                return resultCopy
            }
            let totalTime = this.createDuration(result.TotalTime);
            const behindTime = this.createDuration(result.StartInfo.slice(1));
            totalTime = totalTime.subtract(behindTime);
            resultCopy.TotalTime = totalTime.format('hh:mm:ss.S');
            return resultCopy
        })
    }
}

function analyzeCurrentPage() {
    const links = parseCurrentUrl();
    const raceData = RaceStorage.findData(links.raceId, links.eventId);
    const raceType = raceData.raceFromStorage.ShortDescription;
    let race;
    if (raceType.match(/(mass start|sprint)/i)) {
        race = new Sprint(raceData.raceFromStorage.results);
    } else if (raceType.match(/pursuit/i)) {
        race = new Pursuit(raceData.raceFromStorage.results);
    }
    race.getPureResults();
    race.logResults();
}

async function startApplication() {
    window.momentDurationFormatSetup(moment);
    Storage.init();
    await saveResultsFromCurrentPage();
    analyzeCurrentPage();
}

startApplication();
