import { ethers, zkit } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { poseidon3 } from "poseidon-lite";
import type { RegistrationCircuit } from "../../generated-types/zkit";
import { getWallet, deriveKeysFromUser } from "../../src/utils";

const main = async () => {
    // Configure which wallet to use: 1 for first signer, 2 for second signer
    // Can be overridden with environment variable: WALLET_NUMBER=1 or WALLET_NUMBER=2
    const WALLET_NUMBER = 2;
    
    const wallet = await getWallet(WALLET_NUMBER);
    const userAddress = await wallet.getAddress();
    
    // Read deployment addresses
    const deploymentPath = path.join(__dirname, "../../deployments/standalone/latest-standalone.json");
    const deploymentData = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    
    const registrarAddress = deploymentData.contracts.registrar;
    
    console.log("ðŸ”§ Registering user in Standalone EncryptedERC using zkit...");
    console.log("Registrar:", registrarAddress);
    console.log("User to register:", userAddress);
    
    // Connect to contract using the specific wallet
    const registrar = await ethers.getContractAt("Registrar", registrarAddress, wallet);
    
    // 1. Check if already registered
    const isRegistered = await registrar.isUserRegistered(userAddress);
    if (isRegistered) {
        console.log("âœ?User is already registered");
        return;
    }
    
    // 2. Generate deterministic private key from signature using utils
    console.log("ðŸ”‘ Deriving keys from user signature...");
    const { privateKey, formattedPrivateKey, publicKey, signature } = await deriveKeysFromUser(userAddress, wallet);
    console.log("Private key (raw):", privateKey.toString());
    console.log("Private key (formatted):", formattedPrivateKey.toString());
    console.log("Public key X:", publicKey[0].toString());
    console.log("Public key Y:", publicKey[1].toString());
    
    // 3. Generate registration hash using poseidon3
    const chainId = await ethers.provider.getNetwork().then(net => net.chainId);
    const address = userAddress;
    
    const registrationHash = poseidon3([
        BigInt(chainId),
        formattedPrivateKey,
        BigInt(address),
    ]);
    
    console.log("Chain ID:", chainId.toString());
    console.log("Address:", address);
    console.log("Registration Hash:", registrationHash.toString());
    
    // 4. Generate proof using zkit
    console.log("ðŸ” Generating registration proof using zkit...");
    try {
        // Get the registration circuit
        const circuit = await zkit.getCircuit("RegistrationCircuit");
        const registrationCircuit = circuit as unknown as RegistrationCircuit;
        
        // Prepare inputs for the circuit
        const input = {
            SenderPrivateKey: formattedPrivateKey,
            SenderPublicKey: [publicKey[0], publicKey[1]],
            SenderAddress: BigInt(address),
            ChainID: BigInt(chainId),
            RegistrationHash: registrationHash,
        };
        
        console.log("ðŸ“‹ Circuit inputs:", input);
        
        // Generate proof
        const proof = await registrationCircuit.generateProof(input);
        console.log("âœ?Proof generated successfully using zkit");
        
        // Generate calldata for the contract
        const calldata = await registrationCircuit.generateCalldata(proof);
        console.log("âœ?Calldata generated successfully");
        
        // 5. Call the contract
        console.log("ðŸ“ Registering in the contract...");
        try {
            const registerTx = await registrar.register(calldata);
            await registerTx.wait();
            
            console.log("âœ?User registered successfully!");
        } catch (contractError) {
            console.error("â?Contract error: ", contractError);
            
            // Extract contract error message
            if (contractError instanceof Error) {
                const errorMessage = contractError.message;
                
                // Look for specific contract error message
                if (errorMessage.includes("execution reverted")) {
                    // Try to extract custom error message
                    const revertMatch = errorMessage.match(/execution reverted: (.+)/);
                    if (revertMatch && revertMatch[1]) {
                        console.error("Contract error message:", revertMatch[1]);
                    } else {
                        console.error("Contract reverted without specific message");
                    }
                } else {
                    console.error("Full error:", errorMessage);
                }
                
                // Show additional information for debugging
                console.error("Error details:");
                console.error("- Message:", errorMessage);
                console.error("- Stack:", contractError.stack);
            } else {
                console.error("Unknown error:", contractError);
            }
            
            throw contractError;
        }
        
        // 6. Verify registration
        const isNowRegistered = await registrar.isUserRegistered(userAddress);
        const userPublicKey = await registrar.getUserPublicKey(userAddress);
        
        console.log("Verification:");
        console.log("- Registered:", isNowRegistered);
        console.log("- Public key X:", userPublicKey[0].toString());
        console.log("- Public key Y:", userPublicKey[1].toString());
        
        // 7. Save generated keys for future use
        const userKeys = {
            address: address,
            privateKey: {
                raw: privateKey.toString(),
                formatted: formattedPrivateKey.toString()
            },
            publicKey: {
                x: publicKey[0].toString(),
                y: publicKey[1].toString()
            },
            registrationHash: registrationHash.toString()
        };
        
        const outputDir = path.join(__dirname, "../../deployments/standalone");
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        const keysPath = path.join(outputDir, "user-keys.json");
        fs.writeFileSync(keysPath, JSON.stringify(userKeys, null, 2));
        console.log("ðŸ”‘ User keys saved to:", keysPath);
        
    } catch (error) {
        console.error("â?Error during registration:");
        
        // Show detailed error information
        if (error instanceof Error) {
            console.error("Error type:", error.constructor.name);
            console.error("Message:", error.message);
            
            // If it's a contract error, it was already handled above
            if (error.message.includes("execution reverted")) {
                console.error("This is a contract execution error");
            }
            
            // Show stack trace for debugging
            if (error.stack) {
                console.error("Stack trace:");
                console.error(error.stack);
            }
        } else {
            console.error("Unknown error:", error);
        }
        
        throw error;
    }
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
