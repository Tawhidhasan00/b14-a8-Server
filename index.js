import express from 'express'
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config'
import cors from 'cors';
import { createRemoteJWKSet, jwtVerify } from 'jose';

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


const authURL = process.env.AUTH_URL?.trim().replace(/\/+$/, '');
if (!authURL) throw new Error('AUTH_URL is required');
const JWKS = createRemoteJWKSet(new URL('/api/auth/jwks', authURL));

const verifyUser = async(req, res, next) => {
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({message: 'Unauthorized'});
  }
  const token = authHeader.slice(7).trim();

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: authURL,
      audience: authURL,
      requiredClaims: ['sub', 'email', 'exp'],
    })
    if (typeof payload.sub !== 'string' || !payload.sub.trim() ||
        typeof payload.email !== 'string' || !payload.email.trim()) {
      return res.status(401).json({message: 'Invalid user identity'});
    }
    req.user = {
      id: payload.sub,
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : '',
      image: typeof payload.image === 'string' ? payload.image : null,
    };
  } catch (error) {
    console.error('Token validation failed:', error.message);
    return res.status(401).json({message: 'Invalid or expired token'});
  }

    next();
}

const eventCollection = db.collection('event')
const joinCollection = db.collection('joined')


const myEventCollection = eventCollection;

function getEventOwnerFilter(user) {
    return {$or: [
        {creatorId: user.id},
        {creatorId: {$in: [null, '']}, email: user.email},
    ]};
}

function getParticipantFilter(user) {
    return {$or: [
        {userId: user.id},
        {userId: {$in: [null, '']}, email: user.email},
    ]};
}


function getTodayInDhaka(now = new Date()) {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(now).map(({type, value}) => [type, value])
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function isValidEventDate(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return false;
    }

    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === date && date > getTodayInDhaka();
}

function getEventValidationError(data) {
    const requiredFields = {
        title: 'Title', description: 'Description', eventType: 'Category',
        thumbnail: 'Image URL', location: 'Location', date: 'Event date'
    };
    for (const [field, label] of Object.entries(requiredFields)) {
        if (typeof data[field] !== 'string' || !data[field].trim()) {
            return `${label} is required`;
        }
    }
    const categories = ['Cleanup', 'Plantation', 'Donation', 'Education', 'Food Distribution', 'Winter Relief'];
    if (!categories.includes(data.eventType)) return 'Choose a valid event category';
    try {
        const imageURL = new URL(data.thumbnail);
        if (!['http:', 'https:'].includes(imageURL.protocol)) throw new Error('Invalid image URL');
    } catch {
        return 'Enter a valid image URL starting with http:// or https://';
    }
    if (!isValidEventDate(data.date)) {
        return 'Choose a valid future event date: tomorrow or later in Bangladesh time';
    }
    return null;
}

const editableEventFields = [
    'title', 'eventType', 'location', 'date', 'duration',
    'thumbnail', 'description', 'meetingPoint', 'whatToBring'
];

function getEditableEventData(body) {
    const data = Object.fromEntries(
        editableEventFields
            .filter(field => Object.hasOwn(body, field))
            .map(field => [field, typeof body[field] === 'string' ? body[field].trim() : body[field]])
    );
    if (Object.hasOwn(data, 'duration')) data.duration = Number(data.duration);
    return data;
}

async function createEvent(req, res) {
    const body = req.body ?? {};
    const data = {
        ...getEditableEventData(body),
        creatorId: req.user.id,
        creatorName: req.user.name,
        email: req.user.email,
    };

    const validationError = getEventValidationError(data);
    if (validationError) return res.status(400).json({message: validationError});

    const result = await eventCollection.insertOne(data);
    res.status(201).json(result);
}

app.post('/create-event', verifyUser, createEvent);
app.post('/my-events', verifyUser, createEvent);
app.post('/joined', verifyUser, async(req, res) => {
    const eventId = req.body?.eventId;
    if (typeof eventId !== 'string' || !ObjectId.isValid(eventId)) {
        return res.status(400).json({message: 'Invalid event ID'});
    }
    const event = await eventCollection.findOne({_id: new ObjectId(eventId)});
    if (!event) return res.status(404).json({message: 'Event not found'});
    const {_id, ...eventData} = event;
    const data = {
        ...eventData,
        eventId: _id.toString(),
        userId: req.user.id,
        name: req.user.name,
        email: req.user.email,
        participantImage: req.user.image,
    };
    const existingJoin = await joinCollection.findOne({
        ...getParticipantFilter(req.user),
        eventId: data.eventId,
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
    const query = eventCollection.find({date: {$gt: getTodayInDhaka()}}).sort({date: 1});
    if (req.query.limit === '6') query.limit(6);
    const result = await query.toArray();
    res.send(result)
})
async function getEventById(req, res) {
    const {id} = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({message: 'Invalid event ID'});
    }
    const result = await eventCollection.findOne({
        _id: new ObjectId(id),
        ...(req.user ? getEventOwnerFilter(req.user) : {}),
    });
    if (!result) return res.status(404).json({message: 'Event not found'});
    res.send(result);
}
app.get('/events/:id', getEventById);
app.get('/my-events/:id', verifyUser, getEventById);
app.get('/joined-events/:email', verifyUser, async(req, res) => {
    const {email} = req.params;
    if (email !== req.user.email) return res.status(403).json({message: 'Forbidden'});
    const result = await joinCollection.find(getParticipantFilter(req.user)).sort({date: 1}).toArray()
    res.send(result)
})
app.get('/my-events/user/:email', verifyUser, async(req, res) => {
    const {email} = req.params;
    if (email !== req.user.email) return res.status(403).json({message: 'Forbidden'});
    const result = await myEventCollection.find(getEventOwnerFilter(req.user)).sort({date: 1}).toArray()
    res.send(result)
})


//
app.patch('/my-events/:id', verifyUser, async(req, res) => {

    const {id} = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({message: 'Invalid event ID'});
    }
    const updatedData = getEditableEventData(req.body ?? {});
    if (!Object.keys(updatedData).length) {
        return res.status(400).json({message: 'No editable event fields supplied'});
    }
    const filter = {_id: new ObjectId(id), ...getEventOwnerFilter(req.user)};
    const existingEvent = await myEventCollection.findOne(filter);
    if (!existingEvent) return res.status(404).json({message: 'Event not found'});
    const validationError = getEventValidationError({...existingEvent, ...updatedData});
    if (validationError) return res.status(400).json({message: validationError});

    const result = await myEventCollection.updateOne(
        filter,
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
app.delete('/joined-events/:id', verifyUser, async(req, res) => {
    const {id} = req.params;
    const filter = ObjectId.isValid(id)
        ? { $or: [{ _id: new ObjectId(id) }, { _id: id }] }
        : { _id: id };

    const result = await joinCollection.deleteOne({
        $and: [filter, getParticipantFilter(req.user)],
    });
    if (result.deletedCount === 0) {
        return res.status(404).json({message: 'Registration not found'});
    }
    res.send(result);
})
app.delete('/my-events/:id', verifyUser, async(req, res) => {
    const {id} = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({message: 'Invalid event ID'});
    }

    const result = await myEventCollection.deleteOne({
        _id: new ObjectId(id), ...getEventOwnerFilter(req.user),
    });
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
