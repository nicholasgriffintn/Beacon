import os
import json
import httpx
from typing import Optional
from urllib.parse import urlencode
from fastapi import FastAPI, Request, Form, HTTPException
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, RedirectResponse
from dotenv import load_dotenv

load_dotenv()

WORKER_BASE_URL = os.getenv("WORKER_BASE_URL", "https://beacon.polychat.app")
WORKER_API_KEY = os.getenv("WORKER_API_KEY")

def worker_headers():
    if not WORKER_API_KEY:
        return {}

    return {"X-API-Key": WORKER_API_KEY}

def experiment_results_redirect(experiment_id: str, query: dict[str, str] | None = None):
    url = f"/experiments/{experiment_id}/results"
    if query:
        url = f"{url}?{urlencode(query)}"

    return RedirectResponse(url=url, status_code=303)

app = FastAPI(title="Beacon Admin Dashboard")

templates = Jinja2Templates(directory="templates")

try:
    app.mount("/static", StaticFiles(directory="static"), name="static")
except RuntimeError:
    pass

@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    return templates.TemplateResponse("dashboard.html", {"request": request})

@app.get("/sites", response_class=HTMLResponse)
async def sites_page(request: Request):
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{WORKER_BASE_URL}/api/sites", headers=worker_headers())
            sites = response.json() if response.status_code == 200 else []
    except httpx.HTTPError:
        sites = []
    
    return templates.TemplateResponse("sites.html", {
        "request": request, 
        "sites": sites
    })

@app.post("/sites/create")
async def create_site(
    site_id: str = Form(...),
    name: str = Form(...),
    domains: str = Form(...),
):
    domains_list = [d.strip() for d in domains.split(",") if d.strip()]
    
    async with httpx.AsyncClient() as client:
        response = await client.post(f"{WORKER_BASE_URL}/api/sites", json={
            "site_id": site_id,
            "name": name,
            "domains": domains_list
        }, headers=worker_headers())
    
    if response.status_code != 201:
        raise HTTPException(status_code=400, detail="Failed to create site")
    
    return RedirectResponse(url="/sites", status_code=303)

@app.post("/sites/{site_id}/edit")
async def edit_site(
    site_id: str,
    name: str = Form(...),
    domains: str = Form(...),
    status: str = Form(...)
):
    domains_list = [d.strip() for d in domains.split(",") if d.strip()]
    
    async with httpx.AsyncClient() as client:
        response = await client.put(f"{WORKER_BASE_URL}/api/sites/{site_id}", json={
            "name": name,
            "domains": domains_list,
            "status": status
        }, headers=worker_headers())
    
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to update site")
    
    return RedirectResponse(url="/sites", status_code=303)

@app.post("/sites/{site_id}/delete")
async def delete_site(site_id: str):
    async with httpx.AsyncClient() as client:
        response = await client.delete(f"{WORKER_BASE_URL}/api/sites/{site_id}", headers=worker_headers())
    
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to delete site")
    
    return RedirectResponse(url="/sites", status_code=303)

@app.get("/experiments", response_class=HTMLResponse)
async def experiments_page(request: Request):
    try:
        async with httpx.AsyncClient() as client:
            exp_response = await client.get(f"{WORKER_BASE_URL}/api/experiments", headers=worker_headers())
            experiments = exp_response.json() if exp_response.status_code == 200 else []
            
            sites_response = await client.get(f"{WORKER_BASE_URL}/api/sites", headers=worker_headers())
            sites = sites_response.json() if sites_response.status_code == 200 else []

            flags_response = await client.get(f"{WORKER_BASE_URL}/api/flags", headers=worker_headers())
            flags = flags_response.json() if flags_response.status_code == 200 else []
    except httpx.HTTPError:
        experiments = []
        sites = []
        flags = []
    
    return templates.TemplateResponse("experiments.html", {
        "request": request, 
        "experiments": experiments,
        "sites": sites,
        "flags": flags,
    })

@app.post("/experiments/create")
async def create_experiment(
    flag_key: str = Form(...),
    name: str = Form(...),
    description: str = Form(""),
    experiment_type: str = Form(...),
    site_id: str = Form(""),
    traffic_allocation: float = Form(100.0),
):
    async with httpx.AsyncClient() as client:
        response = await client.post(f"{WORKER_BASE_URL}/api/experiments", json={
            "flag_key": flag_key,
            "name": name,
            "description": description,
            "type": experiment_type,
            "site_id": site_id or None,
            "traffic_allocation": traffic_allocation,
            "variants": [
                {"name": "Control", "type": "control", "config": {}, "traffic_percentage": 50},
                {"name": "Treatment", "type": "treatment", "config": {}, "traffic_percentage": 50}
            ]
        }, headers=worker_headers())
    
    if response.status_code != 201:
        raise HTTPException(status_code=400, detail="Failed to create experiment")
    
    return RedirectResponse(url="/experiments", status_code=303)

@app.get("/flags", response_class=HTMLResponse)
async def flags_page(request: Request):
    try:
        async with httpx.AsyncClient() as client:
            flags_response = await client.get(f"{WORKER_BASE_URL}/api/flags", headers=worker_headers())
            flags = flags_response.json() if flags_response.status_code == 200 else []
            
            sites_response = await client.get(f"{WORKER_BASE_URL}/api/sites", headers=worker_headers())
            sites = sites_response.json() if sites_response.status_code == 200 else []
    except httpx.HTTPError:
        flags = []
        sites = []
    
    return templates.TemplateResponse("flags.html", {
        "request": request, 
        "flags": flags,
        "sites": sites
    })

@app.post("/flags/create")
async def create_flag(
    flag_key: str = Form(...),
    name: str = Form(...),
    description: str = Form(""),
    enabled: bool = Form(False),
    rollout_percentage: float = Form(0.0),
    site_id: Optional[str] = Form(None)
):
    payload = {
        "flag_key": flag_key,
        "name": name,
        "description": description,
        "enabled": enabled,
        "rollout_percentage": rollout_percentage,
        "default_value": False,
        "variations": [
            {"key": "on", "value": True, "description": "Feature enabled"},
            {"key": "off", "value": False, "description": "Feature disabled"}
        ]
    }
    
    if site_id:
        payload["site_id"] = site_id
    
    async with httpx.AsyncClient() as client:
        response = await client.post(f"{WORKER_BASE_URL}/api/flags", json=payload, headers=worker_headers())
    
    if response.status_code != 201:
        raise HTTPException(status_code=400, detail="Failed to create flag")
    
    return RedirectResponse(url="/flags", status_code=303)

@app.post("/flags/{flag_key}/toggle")
async def toggle_flag(flag_key: str):
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{WORKER_BASE_URL}/api/flags/{flag_key}", headers=worker_headers())
        if response.status_code != 200:
            raise HTTPException(status_code=404, detail="Flag not found")
        
        flag = response.json()
        new_enabled = not flag["enabled"]
        
        response = await client.put(f"{WORKER_BASE_URL}/api/flags/{flag_key}", json={
            "enabled": new_enabled
        }, headers=worker_headers())
    
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to toggle flag")
    
    return RedirectResponse(url="/flags", status_code=303)

@app.get("/admin", response_class=HTMLResponse)
async def admin_page(request: Request):
    return templates.TemplateResponse("admin.html", {"request": request})

@app.post("/admin/publish/sites")
async def publish_sites():
    async with httpx.AsyncClient() as client:
        response = await client.post(f"{WORKER_BASE_URL}/api/admin/publish/sites", headers=worker_headers())
    
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to publish sites")
    
    return RedirectResponse(url="/admin", status_code=303)

@app.post("/admin/publish/flags")
async def publish_flags():
    async with httpx.AsyncClient() as client:
        response = await client.post(f"{WORKER_BASE_URL}/api/admin/publish/flags", headers=worker_headers())
    
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to publish feature flags")
    
    return RedirectResponse(url="/admin", status_code=303)

@app.post("/admin/publish/openfeature")
async def publish_openfeature():
    async with httpx.AsyncClient() as client:
        response = await client.post(f"{WORKER_BASE_URL}/api/admin/publish/openfeature", headers=worker_headers())
    
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to publish OpenFeature config")
    
    return RedirectResponse(url="/admin", status_code=303)

@app.post("/admin/publish/all")
async def publish_all():
    async with httpx.AsyncClient() as client:
        response = await client.post(f"{WORKER_BASE_URL}/api/admin/publish/all", headers=worker_headers())
    
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to publish all definitions")
    
    return RedirectResponse(url="/admin", status_code=303)

@app.get("/experiments/{experiment_id}/results", response_class=HTMLResponse)
async def experiment_results(request: Request, experiment_id: str):
    try:
        async with httpx.AsyncClient() as client:
            exp_response = await client.get(f"{WORKER_BASE_URL}/api/experiments/{experiment_id}", headers=worker_headers())
            experiment = exp_response.json() if exp_response.status_code == 200 else None
            
            results_response = await client.get(f"{WORKER_BASE_URL}/api/experiments/{experiment_id}/results", headers=worker_headers())
            results = results_response.json() if results_response.status_code == 200 else None
    except httpx.HTTPError:
        experiment = None
        results = None
    
    return templates.TemplateResponse("experiment_results.html", {
        "request": request,
        "experiment": experiment,
        "results": results,
        "experiment_id": experiment_id,
        "refreshed": request.query_params.get("refreshed") == "1",
        "refresh_error": request.query_params.get("refresh_error")
    })

@app.post("/experiments/{experiment_id}/results/refresh")
async def refresh_experiment_results(experiment_id: str):
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{WORKER_BASE_URL}/api/experiments/{experiment_id}/results/refresh",
                headers=worker_headers(),
            )
    except httpx.HTTPError:
        return experiment_results_redirect(experiment_id, {
            "refresh_error": "Refresh request failed"
        })

    if response.status_code != 200:
        detail = "Failed to refresh experiment results"
        try:
            detail = response.json().get("error") or detail
        except ValueError:
            pass

        return experiment_results_redirect(experiment_id, {
            "refresh_error": detail
        })

    return experiment_results_redirect(experiment_id, {"refreshed": "1"})
