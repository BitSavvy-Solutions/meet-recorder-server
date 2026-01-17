const axios = require('axios');
// REPLACE THESE
const URL = 'https://docs.bitsavvy.ca/api/collections.list';
const TOKEN = "ol_api_JHee4idcxpf090f9pOmjdWoci3ZszuGYfr4gCO";

axios.post(URL, {}, {
    headers: { 'Authorization': `Bearer ${TOKEN}` }
}).then(res => {
    res.data.data.forEach(c => console.log(`Name: ${c.name} | ID: ${c.id}`));
}).catch(e => console.error(e));