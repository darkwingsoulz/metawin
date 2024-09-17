# MetaWin Gaming History and Rewards Dashboard

This project generates personal stats for your MetaWin gaming history and rewards. It covers daily, monthly, game-specific, and overall summaries to help you track your performance and rewards.

If you'd like to support the project, consider donating ETH:

```bash
0x90fCf38FcE6250e9E0187E32C388971aafDD5426
```

Thanks for your support!


## Installation

Follow the steps below to install and run the project.

### 1. Install Node.js

#### Linux (Ubuntu/Debian)
Run the following commands to install Node.js on Linux:
```bash
sudo apt update
sudo apt install nodejs npm
```

#### Windows
Download the Node.js installer from the official website: Node.js. Run the installer and follow the on-screen instructions.

Verify the installation by running the following commands in your terminal or command prompt:

```bash
node -v
npm -v
```

### 2. Clone the Repository
To clone this repository, run the following command in your terminal:

```bash
git clone https://github.com/darkwingsoulz/metawin.git
```

Navigate to the project directory:

```bash
cd metawin
```

### 3. Install Dependencies
Run the following command to install the necessary dependencies:

```bash
npm install
```

### 4. Create the .env File
Copy the .env.sample file provided in the repo to a new .env file:

```bash
cp .env.sample .env
```
Edit the .env file and add your values. For example:

```bash
TOKEN_BEARER=YOUR_BEARER_TOKEN
PAGE_SIZE=1000
BATCH_SIZE=25
```
Retrieving the TOKEN_BEARER:
Go to the MetaWin website and log in.
Open your browser's developer console (F12 or right-click and select "Inspect").
Go to the Network tab, then perform any game-related action (e.g., check your game history).
Look for a network request to the Game History endpoint.
Click on that request, go to the Headers tab, and find the Authorization header. The value after Bearer is your TOKEN_BEARER.

### 5. Running the Project
Note that for the first time, this script could take several minutes depending on how much history you have.
The bearer token you provided is only valid for a few minutes of idle time, so please ensure you navigate the Game History tab on the website to keep 
this token active until the report compltes.  All data is saved locally.  Subsequent runs will only download new history and will run very quickly.

For future runs, always get a new token bearer to place in your ENV file.

After setting up the .env file, you can run the project using:

```bash
node runstat.js
```

### 6. Viewing the Report
When the script is complete, a file called latest_report.html will be created in the output sub folder inside the script directory
Open this file in your browser to view formatted results
 
