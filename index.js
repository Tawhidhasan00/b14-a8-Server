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
const joinCollection = db.collection('joined')

// Public listings and creator management use the same event documents.
const myEventCollection = eventCollection;


function isValidEventDate(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return false;
    }

    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

const editableEventFields = [
    'title', 'eventType', 'location', 'date', 'duration',
    'thumbnail', 'description', 'meetingPoint', 'whatToBring'
];

function getEditableEventData(body) {
    const data = Object.fromEntries(
        editableEventFields
            .filter(field => Object.hasOwn(body, field))
            .map(field => [field, body[field]])
    );
    if (Object.hasOwn(data, 'duration')) data.duration = Number(data.duration);
    return data;
}

async function createEvent(req, res) {
    const body = req.body ?? {};
    if (typeof body.email !== 'string' || !body.email.trim() ||
        typeof body.creatorId !== 'string' || !body.creatorId.trim()) {
        return res.status(400).json({message: 'Creator ID and email are required'});
    }
    if (!isValidEventDate(body.date)) {
        return res.status(400).json({message: 'A valid event date is required (YYYY-MM-DD).'});
    }

    const data = {
        ...getEditableEventData(body),
        creatorId: body.creatorId.trim(),
        creatorName: typeof body.creatorName === 'string' ? body.creatorName.trim() : '',
        email: body.email.trim(),
    };

    const result = await eventCollection.insertOne(data);
    res.status(201).json(result);
}

app.post('/create-event', createEvent);
app.post('/my-events', createEvent);
app.post('/joined', async(req, res) => {
    const data = req.body

    if (
        typeof data?.email !== 'string' ||
        !data.email.trim()
    ) {
        return res.status(400).json({
            message: 'Participant email is required'
        });
    }
    const existingJoin = await joinCollection.findOne({
        email: data.email,
        eventId: data.eventId
    });

    if (existingJoin) {
        return res.json({
            alreadyJoined: true,
            message: 'You already joined this event'
        });
    }
    
    const result = await joinCollection.insertOne(data);
    res.send(result)
})



//
app.get('/events', async(req, res) => {
    const result = await eventCollection.find().sort({date: 1}).toArray();
    res.send(result)
})
async function getEventById(req, res) {
    const {id} = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({message: 'Invalid event ID'});
    }
    const result = await eventCollection.findOne({_id: new ObjectId(id)});
    if (!result) return res.status(404).json({message: 'Event not found'});
    res.send(result);
}
app.get('/events/:id', getEventById);
app.get('/my-events/:id', getEventById);
app.get('/joined-events/:email', async(req, res) => {
    const {email} = req.params;
    const result = await joinCollection.find({email:email}).toArray()
    res.send(result)
})
app.get('/my-events/user/:email', async(req, res) => {
    const {email} = req.params;
    const result = await myEventCollection.find({email: email.trim()}).sort({date: 1}).toArray()
    res.send(result)
})


//
app.patch('/my-events/:id', async(req, res) => {
    const {id} = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({message: 'Invalid event ID'});
    }
    const updatedData = getEditableEventData(req.body ?? {});
    if (!Object.keys(updatedData).length) {
        return res.status(400).json({message: 'No editable event fields supplied'});
    }
    if (Object.hasOwn(updatedData, 'date') && !isValidEventDate(updatedData.date)) {
        return res.status(400).json({message: 'Event date must be a valid date in YYYY-MM-DD format.'});
    }

    const result = await myEventCollection.updateOne(
        {_id: new ObjectId(id)},
        {$set: updatedData}
    )
    if (result.matchedCount === 0) {
        return res.status(404).json({message: 'Event not found'});
    }
    res.status(200).json(result)
})

//
// app.delete('/events/:id', async(req, res) => {
//     const {id} = await req.params;
//     const result = await eventCollection.deleteOne({_id: new ObjectId(id)})
//     res.json(result);
// })
app.delete('/joined-events/:id', async(req, res) => {
    const {id} = req.params;
    const filter = ObjectId.isValid(id)
        ? { $or: [{ _id: new ObjectId(id) }, { _id: id }] }
        : { _id: id };

    const result = await joinCollection.deleteOne(filter);
    res.send(result);
})
app.delete('/my-events/:id', async(req, res) => {
    const {id} = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({message: 'Invalid event ID'});
    }

    const result = await myEventCollection.deleteOne({_id: new ObjectId(id)});
    if (result.deletedCount === 0) {
        return res.status(404).json({message: 'Event not found'});
    }
    res.send(result);
})





app.get('/', (req, res) => {
    res.send({message: 'Server is running..'})
})

app.listen(PORT, () => {
    console.log(`Server is running at ${PORT}`)
})

export default app;
