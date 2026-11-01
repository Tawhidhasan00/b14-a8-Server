import express from 'express'
import { MongoClient } from 'mongodb';
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



app.post('/create-event', async(req, res) => {
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


app.get('/', (req, res) => {
    res.send({message: 'Server is running..'})
})

app.listen(PORT, () => {
    console.log(`Server is running at ${PORT}`)
})