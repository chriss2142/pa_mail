const imaps = require('imap-simple');
const fs = require('fs');
const path = require('path');
const simpleParser = require('mailparser').simpleParser;
require('dotenv').config();

const OpenAI = require('openai');

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Configuration for IMAP connection
const config = {
    imap: {
        user: process.env.PA_MAIL_USER || '',
        password: process.env.PA_MAIL_PASSWORD || '',
        host: process.env.PA_MAIL_HOST || '',
        port: parseInt(process.env.PA_MAIL_PORT) || 993,
        tls: process.env.PA_MAIL_TLS === 'false' ? false : true,
        authTimeout: 3000
    }
};

async function fetchEmails() {

    // Function to fetch emails from today
    const mails = [];

    try {
        // Connect to the IMAP server
        const connection = await imaps.connect(config);

        // Open the INBOX
        await connection.openBox('INBOX');

        // Get today's date in the format 'DD-MMM-YYYY'
        const today = new Date();
        const dateString = today.toLocaleString('en-US', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        }).replace(/,/, '');

        // Search for emails from today
        const searchCriteria = [['SINCE', dateString]];
        const fetchOptions = {
            bodies: ['HEADER', 'TEXT'],
            struct: true
        };

        const messages = await connection.search(searchCriteria, fetchOptions);

        for (const item of messages) {
            const all = imaps.getParts(item.attributes.struct);

            const headerPart = item.parts.find(part => part.which === 'HEADER');
            const bodyPart = item.parts.find(part => part.which === 'TEXT');

            const headers = headerPart ? headerPart.body : {};

            const emailDetails = {
                from: headers.from ? headers.from[0] : null,
                to: headers.to ? headers.to[0] : null,
                subject: headers.subject ? headers.subject[0] : null,
                date: headers.date ? headers.date[0] : null,
                body: null,
                attachments: []
            };

            // Parse the full email body and attachments
            for (const part of all) {
                if (part.disposition && part.disposition.type === 'attachment') {
                    // Handle attachments
                    const attachment = await connection.getPartData(item, part);
                    const fileName = part.disposition.params.filename;
                    const filePath = path.join(__dirname, 'attachments', fileName);
                    fs.writeFileSync(filePath, attachment);
                    emailDetails.attachments.push({
                        filename: fileName,
                        path: filePath
                    });
                } else if (!part.disposition && part.encoding) {
                    // Handle plain text or HTML parts
                    const rawBody = await connection.getPartData(item, part);
                    emailDetails.body = rawBody;
                }
            }

            // Save the email details to the array
            mails.push(emailDetails);
            //console.log(emailDetails);
        }

        // Close the connection
        connection.end();
    } catch (error) {
        console.error('Error fetching emails:', error);
    }
    return mails;
};

async function createTextFromMails(mails) {
    let textBlob = '';
    
    for (const mail of mails) {
        textBlob += `\nFrom: ${mail.from}\n`;
        textBlob += `Subject: ${mail.subject}\n`;
        textBlob += `Date: ${mail.date}\n`;
        
        let cleanBody = mail.body || '';
        
        // Remove style tags and their content
        cleanBody = cleanBody.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        
        // Remove CSS media queries and other style definitions
        cleanBody = cleanBody.replace(/@media[^{]*{[\s\S]*?}/gi, '');
        cleanBody = cleanBody.replace(/{[^}]*}/g, '');
        
        // Replace <a> tags with their text and URL
        cleanBody = cleanBody.replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/g, '$2 ($1)');
        
        // Remove all remaining HTML tags
        cleanBody = cleanBody.replace(/<[^>]*>/g, ' ');
        
        // Clean up whitespace and line breaks
        cleanBody = cleanBody.replace(/\s+/g, ' ').trim();
        
        // Decode HTML entities
        cleanBody = cleanBody.replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"');
        
        textBlob += `Content:\n${cleanBody}\n`;
        textBlob += `-------------------\n`;
    }
    
    return textBlob;
}


async function createTextFromMailsWithoutLinks(mailsArray) {
    if (!Array.isArray(mailsArray)) {
        return '';
    }

    let textBlob = '';
    
    for (const mail of mailsArray) {
        textBlob += `\nFrom: ${mail.from}\n`;
        textBlob += `Subject: ${mail.subject}\n`;
        //textBlob += `Date: ${mail.date}\n`;
        
        let cleanBody = mail.body || mail.subject || '';
        
        // Remove style tags and their content
        cleanBody = cleanBody.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        
        // Remove CSS media queries and other style definitions
        cleanBody = cleanBody.replace(/@media[^{]*{[\s\S]*?}/gi, '');
        cleanBody = cleanBody.replace(/{[^}]*}/g, '');
        
        // Remove <a> tags completely, keeping only the text
        cleanBody = cleanBody.replace(/<a\s+(?:[^>]*?\s+)?href="[^"]*"[^>]*>(.*?)<\/a>/g, '$1');
        
        // Remove all remaining HTML tags
        cleanBody = cleanBody.replace(/<[^>]*>/g, ' ');
        
        // Clean up whitespace and line breaks
        cleanBody = cleanBody.replace(/\s+/g, ' ').trim();
        
        // Decode HTML entities
        cleanBody = cleanBody.replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"');
        
        textBlob += `Content:\n${cleanBody}\n`;
        textBlob += `-------------------\n`;
    }
    
    return textBlob;
}


function filterEmails(mails, blacklist) {
    // Normalize blacklist to lowercase for case-insensitive comparison
    const normalizedBlacklist = blacklist.map(item => item.toLowerCase());
    
    return mails.filter(mail => {
        if (!mail.from) return false; // Exclude emails without sender

        // Extract the email address from the "from" field
        const emailMatch = mail.from.match(/<(.+?)>/);
        const senderEmail = emailMatch ? emailMatch[1].toLowerCase() : mail.from.toLowerCase();
        //console.log("Sender Email: ", senderEmail);
        // Check if the email is not in the blacklist
        const result = !normalizedBlacklist.some(blocked => {
            //console.log("\tBlocked: ", blocked);
            if (blocked.startsWith('@')) {
                //if(senderEmail.endsWith(blocked))console.log("\t\tDomain-based blacklist match");
                // Match domain-based blacklist
                return senderEmail.endsWith(blocked);
            }
            // Match full email address
            //if(senderEmail === blocked)console.log("\t\tDirectt blacklist match");
            return senderEmail === blocked;
        });

        //console.log("Result: ", result);
        return result;
    });
}


async function processWithGPT(content) {
    try {
        // Read the prompt from prompt.txt using promises
        const prompt = await fs.promises.readFile('promt.txt', 'utf8');
        
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: prompt },
                { role: "user", content: content }
            ],
            temperature: 0.3,
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error('Error processing with GPT:', error);
        return 'Error processing content with GPT';
    }
}

// Replace the hardcoded blacklist array with this function
async function loadBlacklist() {
    try {
        const content = await fs.promises.readFile('blacklist.txt', 'utf8');
        // Split by both \n and \r\n, filter out empty lines
        return content.split(/\r?\n/).filter(line => line.trim().length > 0);
    } catch (error) {
        console.error('Error reading blacklist.txt:', error);
        return []; // Return empty array as fallback
    }
}

function validateAndFilterSummaries(text) {
    // Pattern to match entire blocks from "From:" to "-------------------"
    const pattern = /From:.*?-------------------/gs;
    
    // Find all matches in the text
    const matches = text.match(pattern);
    
    if (!matches) {
        return text;
    }
    
    // Remove all matched blocks from the text
    let cleanedText = text;
    matches.forEach(match => {
        cleanedText = cleanedText.replace(match, '');
    });
    
    // Clean up any remaining whitespace
    return cleanedText.trim();
}




// Wrap the execution in an async function
async function main() {

    const blacklist = await loadBlacklist();
    const mails = await fetchEmails();
    const filteredMails = filterEmails(mails, blacklist);
    const processedTextWithLinks = await createTextFromMails(filteredMails);
    const processedTextWithoutLinks = await createTextFromMailsWithoutLinks(filteredMails);
    
    // Process with GPT and log the result
    const gptResult = await processWithGPT(processedTextWithoutLinks);
    const validatedResult = validateAndFilterSummaries(gptResult);
    
    // Write the result to output.txt, overwriting if it exists
    fs.writeFileSync('output.txt', validatedResult, 'utf8');
}

// Call the main function
main().catch(console.error);