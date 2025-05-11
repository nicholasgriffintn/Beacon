from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Beacon Dashboard")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/hello")
async def hello_world():
    return {"message": "Hello from Beacon Dashboard Backend!"}

@app.get("/api/health")
async def health_check():
    return {"status": "healthy"} 