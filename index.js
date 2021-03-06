require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;

// middle ware
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("doctors portal running the server");
});

app.listen(port, () => {
  console.log(`Doctors portal app listening on port ${port}`);
});

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `${process.env.URI}`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "UnAuthorized Access" });
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden Access" });
    }
    req.decoded = decoded;
    next();
    // console.log("error", err);
    // console.log("decoded", decoded);
  });
}
// email sent user for booking appointment
function sendAppointmentEmail(booking) {
  const { patient, patientName, date, slot, treatment } = booking;
  const mailjet = require("node-mailjet").connect(
    process.env.MJ_APIKEY_PUBLIC,
    process.env.MJ_APIKEY_PRIVATE
  );
  const request = mailjet.post("send", { version: "v3.1" }).request({
    Messages: [
      {
        From: {
          Email: "raselmahmud98262@gmail.com",
          Name: "Portal",
        },
        To: [
          {
            Email: `${patient}`,
            Name: `${patientName}`,
          },
        ],
        Subject: `You have booked an appointment on ${date}`,
        TextPart: `You have booked an appointment on ${date} treatment is ${treatment}`,
        HTMLPart: `<h2>Hello patient You have an appointment on ${date} treatment is ${treatment}</h2>
      <h5>Please add to your calender this time ${slot}</h5>
      <a href="https://google.com">for reminder mail click here</a>
      `,
      },
    ],
  });
  request
    .then((result) => {
      console.log("success", result.body);
    })
    .catch((err) => {
      console.log("getting err", err.statusCode);
    });
}
// email sent user for payment confirmed
function sendPaymentConfirmEmail(info) {
  const { patient, patientName, date, slot, treatment, transactionId, price } = info;
  const mailjet = require("node-mailjet").connect(
    process.env.MJ_APIKEY_PUBLIC,
    process.env.MJ_APIKEY_PRIVATE
  );
  const request = mailjet.post("send", { version: "v3.1" }).request({
    Messages: [
      {
        From: {
          Email: "raselmahmud98262@gmail.com",
          Name: "Doctors Portal",
        },
        To: [
          {
            Email: `${patient}`,
            Name: `${patientName}`,
          },
        ],
        Subject: `Payment is success for an appointment on ${date}`,
        TextPart: `Payment is success for an appointment on ${date} treatment is ${treatment}`,
        HTMLPart: `<h2>Hello ${patientName} You have an appointment on ${date} ${slot}.</h2>
        <li>your transaction id ${transactionId}</li>
        <li>Service price ${price}</li>
      <h5>Please add to your calender this date</h5>
      <a href="https://google.com">for reminder mail click here</a>
      `,
      },
    ],
  });
  request
    .then((result) => {
      console.log("success", result.body);
    })
    .catch((err) => {
      console.log("getting err", err.statusCode);
    });
}

async function run() {
  try {
    await client.connect();
    //  all collections here
    const servicesCollection = client
      .db("doctor_portal")
      .collection("services");
    const bookingCollection = client.db("doctor_portal").collection("booking");
    const userCollection = client.db("doctor_portal").collection("user");
    const doctorsCollection = client.db("doctor_portal").collection("doctors");
    const paymentsCollection = client
      .db("doctor_portal")
      .collection("payments");
    // verify admin role
    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterAccount = await userCollection.findOne({
        email: requester,
      });
      if (requesterAccount.role === "admin") {
        next();
      } else {
        res.status(403).send({ message: "Forbidden request" });
      }
    };
    // all users
    app.get("/all-user", verifyJWT, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });
    // admin checking
    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user?.role === "admin";
      res.send({ admin: isAdmin });
    });
    // make a admin
    app.put("/user/admin/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updateDoc = {
        $set: { role: "admin" },
      };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    });
    // insert or update users
    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      // console.log(email);
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      const token = jwt.sign(
        { email: email },
        process.env.ACCESS_TOKEN_SECRET,
        {
          expiresIn: "1d",
        }
      );
      res.send({ result, token });
    });
    app.get("/available", async (req, res) => {
      const date = req.query.date;
      // step 1: to get all services
      const services = await servicesCollection.find().toArray();
      //step 2: get the booking of that day
      const query = { date: date };
      const bookings = await bookingCollection.find(query).toArray();
      // step 3 for each service, find booking for that service
      services.forEach((service) => {
        const serviceBookings = bookings.filter(
          (book) => book.treatment === service.name
        );
        const bookedSlots = serviceBookings.map((book) => book.slot);
        const available = service.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        service.slots = available;
      });
      res.send(services);
    });
    // get a specific booking for payment
    app.get("/booking/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const booking = await bookingCollection.findOne(query);
      // console.log("A unique book",booking);
      res.send(booking);
    });
    // get all booking record
    app.get("/booking", verifyJWT, async (req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;
      if (patient === decodedEmail) {
        const query = { patient: patient };
        const booking = await bookingCollection.find(query).toArray();
        return res.send(booking);
      } else {
        return res.status(400).send({ message: "Bad Request" });
      }
    });
    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        treatment: booking,
        date: booking.date,
        patient: booking.patient,
      };
      const exists = await bookingCollection.findOne(query);
      if (exists) {
        // console.log(exists);
        return res.send({ success: false, booking: exists });
      } else {
        const result = await bookingCollection.insertOne(booking);
        sendAppointmentEmail(booking);
        res.send({ success: true, result });
      }
    });

    app.get("/services", async (req, res) => {
      const query = {};
      const cursor = servicesCollection.find(query).project({ name: 1 });
      const result = await cursor.toArray();
      res.send(result);
    });
    // for doctor post
    app.post("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      // console.log(doctor);
      const result = await doctorsCollection.insertOne(doctor);
      res.send(result);
    });
    // get all doctors
    app.get("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const doctors = await doctorsCollection.find().toArray();
      res.send(doctors);
    });
    // delete a doctor
    app.delete("/doctor/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const doctor = await doctorsCollection.deleteOne({ email: email });
      res.send(doctor);
    });
    // make a payment intent post api
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const service = req.body;
      // console.log("service", service);
      const price = service.price;
      const amount = price * 100;
      // console.log("amount", typeof amount);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });
    // update for payment success
    app.patch("/booking/:id", async (req, res) => {
      const id = req.params.id;
      const payment = req.body;
      const filter = { _id: ObjectId(id) };
      const updateDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId,
        },
      };
      const result = await paymentsCollection.insertOne(payment);
      const updatedBooking = await bookingCollection.updateOne(
        filter,
        updateDoc
      );
      const find = await bookingCollection.findOne(filter);
      sendPaymentConfirmEmail(find);
      console.log("update ingo booking",find);
      res.send(updateDoc);
    });
  } catch (err) {
    console.log(err);
  }
}
run().catch(console.dir);
