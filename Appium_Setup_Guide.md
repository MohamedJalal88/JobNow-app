# Complete Appium & Android Emulator Setup Guide (Windows)

To run Appium mobile automation tests on your computer, you need to set up the Android development environment. Follow these steps carefully:

## Step 1: Install Java (JDK)
Android tools require Java to run.
1. Download **Java 17 (or Java 11) JDK** for Windows from [Adoptium (Eclipse Temurin)](https://adoptium.net/).
2. Run the installer. **Important:** During installation, make sure you check the box that says **"Set JAVA_HOME environment variable"** and **"Add to PATH"**.

## Step 2: Install Android Studio
This provides the Android SDK and the Emulator.
1. Download **Android Studio** from the [official website](https://developer.android.com/studio).
2. Run the installer. Leave all default options checked (especially the Android SDK, Android SDK Platform, and Android Virtual Device).
3. Once installed, open Android Studio and let it finish downloading any initial SDK components it prompts you for.

## Step 3: Set Environment Variables
Your computer needs to know where the Android SDK is installed so Appium can use it.
1. Press the Windows key, search for **"Environment Variables"**, and click **"Edit the system environment variables"**.
2. Click the **"Environment Variables..."** button at the bottom right.
3. Under **System variables** (the bottom list), click **New**.
   - **Variable name:** `ANDROID_HOME`
   - **Variable value:** `C:\Users\aysha\AppData\Local\Android\Sdk` (Ensure this path is correct for your user).
4. Now, find the `Path` variable in the System variables list, select it, and click **Edit**.
5. Click **New** and add these three paths:
   - `%ANDROID_HOME%\emulator`
   - `%ANDROID_HOME%\tools`
   - `%ANDROID_HOME%\tools\bin`
   - `%ANDROID_HOME%\platform-tools`
6. Click OK to save everything. Restart your VS Code and Terminal for these changes to take effect.

## Step 4: Create an Android Emulator
1. Open **Android Studio**.
2. Click on **More Actions** (or Tools) > **Virtual Device Manager**.
3. Click **Create Device**.
4. Choose a phone like **Pixel 6** or **Pixel 7** and click Next.
5. Select a System Image (e.g., API Level 33 or 34). You may need to click the "Download" arrow next to it first.
6. Click Next and then **Finish**.
7. Click the **Play (▶)** button next to your new device to launch the emulator. Keep it running!

## Step 5: Install Appium and WebdriverIO
Now that your Android environment is ready, install the Appium testing tools.
Open your VS Code terminal and run:

```bash
# Install Appium globally
npm install -g appium

# Install the UIAutomator2 driver (which Appium uses to control Android)
appium driver install uiautomator2

# Verify everything is correctly set up
npm install -g appium-doctor
appium-doctor --android
```
*(If `appium-doctor` shows green checkmarks for `JAVA_HOME` and `ANDROID_HOME`, you are perfectly set up!)*

## Next Steps
Once you have completed this setup and have the Android Emulator running on your screen, let me know! I will then provide the automated Appium test script and we can execute it to test the login flows and generate the Excel report.
