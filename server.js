require('dotenv').config();
const express = require('express');
const { ApolloServer, gql } = require('apollo-server-express');
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const ImageKit = require("imagekit");
const multer = require('multer');

const MONGO_URI = process.env.MONGO_URI; 
const JWT_SECRET = process.env.JWT_SECRET || 'baytary-secure-key-2026';

const imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch(err => console.error("❌ MongoDB Error:", err));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const generateId = () => String(Math.floor(100000 + Math.random() * 900000));

// --- Mongoose Schemas ---
const Banner = mongoose.model('Banner', new mongoose.Schema({ _id: String, image: String, title: String, productId: String }));
const Category = mongoose.model('Category', new mongoose.Schema({ _id: String, name: String, image: String }));
const Product = mongoose.model('Product', new mongoose.Schema({ _id: String, title: String, price: Number, description: String, images: [String], categoryId: String }));
const User = mongoose.model('User', new mongoose.Schema({ _id: String, name: String, email: { type: String, unique: true }, password: String, role: { type: String, enum: ['admin', 'customer'], default: 'customer' }, avatar: String }));

// --- GraphQL Schema ---
const typeDefs = gql`
    enum Role { admin customer }
    type Banner { id: ID! image: String title: String productId: String }
    type Category { id: ID! name: String image: String }
    type Product { id: ID! title: String price: Float description: String images: [String] category: Category categoryId: Float }
    type User { id: ID! name: String email: String role: Role avatar: String }
    type AuthPayload { access_token: String refresh_token: String }

    input BannerInput { image: String title: String productId: String }
    input UserInput { name: String email: String password: String avatar: String role: Role }
    input ProductInput { title: String price: Float description: String categoryId: Float images: [String] }
    input CategoryInput { name: String image: String }

    type Query {
        banners: [Banner]
        products(limit: Int, offset: Int, title: String, categoryId: Float, price_min: Int, price_max: Int): [Product]
        product(id: ID!): Product
        categories: [Category]
        category(id: ID!): Category
        users: [User]
        user(id: ID!): User
        myProfile: User
        isAvailable(email: String!): Boolean
    }

    type Mutation {
        login(email: String!, password: String!): AuthPayload
        addBanner(data: BannerInput!): Banner
        updateBanner(id: ID!, changes: BannerInput!): Banner
        deleteBanner(id: ID!): Boolean
        addUser(data: UserInput!): User
        deleteUser(id: ID!): Boolean
        addProduct(data: ProductInput!): Product
        updateProduct(id: ID!, changes: ProductInput!): Product
        deleteProduct(id: ID!): Boolean
        addCategory(data: CategoryInput!): Category
        updateCategory(id: ID!, changes: CategoryInput!): Category
        deleteCategory(id: ID!): Boolean
    }
`;

// --- Resolvers ---
const resolvers = {
    Query: {
        banners: async () => await Banner.find(),
        products: async (_, { limit, offset, title, categoryId, price_min, price_max }) => {
            let filter = {};
            if (title) filter.title = { $regex: title, $options: 'i' };
            if (categoryId) filter.categoryId = String(categoryId); 
            if (price_min != null || price_max != null) {
                filter.price = {};
                if (price_min != null) filter.price.$gte = price_min;
                if (price_max != null) filter.price.$lte = price_max;
            }
            let query = Product.find(filter);
            if (offset !== undefined && limit !== undefined) query = query.skip(offset).limit(limit);
            return await query;
        },
        product: async (_, { id }) => await Product.findById(id),
        categories: async () => await Category.find(),
        category: async (_, { id }) => await Category.findById(id),
        users: async () => await User.find(),
        user: async (_, { id }) => await User.findById(id),
        myProfile: async (_, __, { user }) => user,
        isAvailable: async (_, { email }) => {
            const count = await User.countDocuments({ email });
            return count === 0;
        }
    },
    Product: {
        categoryId: (parent) => parseFloat(parent.categoryId), 
        category: async (parent) => {
            try { return await Category.findById(parent.categoryId); } catch (e) { return null; }
        }
    },
    Mutation: {
        login: async (_, { email, password }) => {
            const user = await User.findOne({ email, password });
            if (!user) throw new Error('Unauthorized');
            return { 
                access_token: jwt.sign({ sub: user._id }, JWT_SECRET), 
                refresh_token: jwt.sign({ sub: user._id }, JWT_SECRET) 
            };
        },
        addBanner: async (_, { data }) => {
            const banner = new Banner({ _id: generateId(), ...data });
            return await banner.save();
        },
        updateBanner: async (_, { id, changes }) => await Banner.findByIdAndUpdate(id, changes, { new: true }),
        deleteBanner: async (_, { id }) => { await Banner.findByIdAndDelete(id); return true; },
        addUser: async (_, { data }) => {
            const user = new User({ _id: generateId(), ...data });
            return await user.save();
        },
        deleteUser: async (_, { id }) => { await User.findByIdAndDelete(id); return true; },
        addProduct: async (_, { data }) => {
            const productData = { ...data, categoryId: String(data.categoryId) };
            const product = new Product({ _id: generateId(), ...productData });
            return await product.save();
        },
        updateProduct: async (_, { id, changes }) => {
            let updateData = { ...changes };
            if (changes.categoryId) updateData.categoryId = String(changes.categoryId);
            return await Product.findByIdAndUpdate(id, updateData, { new: true });
        },
        deleteProduct: async (_, { id }) => { await Product.findByIdAndDelete(id); return true; },
        addCategory: async (_, { data }) => {
            const cat = new Category({ _id: generateId(), ...data });
            return await cat.save();
        },
        updateCategory: async (_, { id, changes }) => await Category.findByIdAndUpdate(id, changes, { new: true }),
        deleteCategory: async (_, { id }) => { await Category.findByIdAndDelete(id); return true; },
    }
};

const app = express();
app.use(cors());
app.use(bodyParser.json());

// مسارات API
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No file" });
        const result = await imagekit.upload({ file: req.file.buffer, fileName: req.file.originalname, folder: "/baytary_uploads" });
        res.json({ location: result.url, filename: result.name });
    } catch (error) { res.status(500).json({ message: "Upload failed" }); }
});

app.get('/api/v1/auth/profile', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).send();
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.sub);
        res.json(user);
    } catch (e) { res.status(401).send(); }
});

const server = new ApolloServer({ typeDefs, resolvers });

const startApolloServer = async () => {
    await server.start();
    server.applyMiddleware({ app, path: '/graphql' });
};

startApolloServer();

// التصدير لمنصة Vercel
module.exports = app;
