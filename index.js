import express from 'express'
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config'
import cors from 'cors';

const app = express();
const PORT = 5000

app.use(cors());
app.use(express.json());

// Database connection
const client = new MongoClient(process.env.MONGODB_URL);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}
const mongoClient = await connectToMongoDB();
const db = mongoClient.db('commonKind')
const eventCollection = db.collection('event')

function isValidEventDate(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return false;
    }

    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}


app.post('/create-event', async(req, res) => {
    if (!isValidEventDate(req.body?.date)) {
        return res.status(400).json({message: 'A valid event date is required (YYYY-MM-DD).'});
    }

    const data = {
        ...req.body,
        duration: Number(req.body.duration)}

    const result = await eventCollection.insertOne(data)

    console.log(result)
    res.send({message: 'API is working..'}, result)
})



app.get('/events', async(req, res) => {
    const result = await eventCollection.find().toArray();
    res.send(result)
})
app.get('/events/:id', async(req, res) => {
    const {id} = req.params
    const result = await eventCollection.findOne({_id: new ObjectId(id)})
    res.send(result)
})

app.patch('/events/:id', async(req, res) => {
    const {id} = req.params;
    const updatedData = req.body;
    if (Object.hasOwn(updatedData ?? {}, 'date') && !isValidEventDate(updatedData.date)) {
        return res.status(400).json({message: 'Event date must be a valid date in YYYY-MM-DD format.'});
    }

    const result = await eventCollection.updateOne(
        {_id: new ObjectId(id)},
        {$set: updatedData}
    )
    res.status(200).json(result)
})


app.get('/', (req, res) => {
    res.send({message: 'Server is running..'})
})

app.listen(PORT, () => {
    console.log(`Server is running at ${PORT}`)
})
